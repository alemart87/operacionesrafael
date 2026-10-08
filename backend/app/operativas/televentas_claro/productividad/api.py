"""API de Productividad de llamadas — Televentas Claro.

Permisos:
* `televentas_claro.productividad`          → ver informes diarios PUBLICADOS y los acumulados.
* `televentas_claro.productividad_gestion`  → subir cortes, ver borradores, publicar, reemplazar,
                                              recalcular y eliminar.
* Los parámetros (metas y reglas) los cambia solo el superadmin.

Circuito (el mismo de Ventas Netas, por día en lugar de por mes): cada corte
subido actualiza el borrador de su fecha de gestión; gestión lo publica y como
máximo hay un informe publicado por día. Publicar sobre un día que ya tiene uno
exige `confirm_replace=True` (si no, 409 con los datos del publicado actual).
Los acumulados (semana, mes, rango) se calculan solo con los días publicados.
"""
from __future__ import annotations

import asyncio
import gzip
import hashlib
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import CurrentUser, client_ip, require_perm
from ....core.config import settings
from ....core.database import get_db
from ....models.user import User
from ....services.audit_service import record_action
from .analyzer import PARAMETROS_DEFECTO, VERSION_ANALISIS, acumular, analizar_dia, resumen_lista, validar_parametros
from .models import ESTADO_BORRADOR, ESTADO_PUBLICADO, ESTADO_REEMPLAZADO, ProdCorte, ProdInforme, ProdParametros
from .parser import ZONA, ArchivoInvalido, a_local, corte_de_nombre, parse_tiempos

PERM_VER = "televentas_claro.productividad"
PERM_GESTION = "televentas_claro.productividad_gestion"
require_ver = require_perm(PERM_VER)
require_gestion = require_perm(PERM_GESTION)

router = APIRouter(prefix="/televentas-claro/productividad", tags=["televentas-claro · productividad"])

MAX_CSV_BYTES = 2 * 1024 * 1024
MAX_DIAS_ACUMULADO = 93
# Un solo proceso atiende la API: este lock evita dos borradores del mismo día por cargas simultáneas.
_lock_dia = asyncio.Lock()


# ------------------------------------------------------------------ utilidades
def _utc(d: datetime | None) -> datetime | None:
    return d.replace(tzinfo=timezone.utc) if d is not None and d.tzinfo is None else d


def _iso(d: datetime | None) -> str | None:
    d = _utc(d)
    return d.isoformat() if d else None


async def _nombres(db: AsyncSession, ids: set[str | None]) -> dict[str, str]:
    ids = {i for i in ids if i}
    out = {"superadmin": settings.superadmin_name}
    if ids:
        rows = await db.execute(select(User.id, User.full_name).where(User.id.in_(ids)))
        out.update({i: n for i, n in rows.all()})
    return out


async def parametros(db: AsyncSession) -> dict[str, Any]:
    fila = await db.get(ProdParametros, 1)
    try:
        return validar_parametros(fila.data if fila else {})
    except ValueError:
        return dict(PARAMETROS_DEFECTO)


def _resumen(r: ProdInforme) -> dict[str, Any]:
    return {
        "id": r.id, "fecha": r.fecha.isoformat(), "status": r.status,
        "generated_at": _iso(r.generated_at), "generated_by": r.generated_by,
        "published_at": _iso(r.published_at), "published_by": r.published_by,
        "replaced_at": _iso(r.replaced_at), "replaced_by_report_id": r.replaced_by_report_id,
        "cortes": r.cortes, "corte_final": r.corte_final, "agentes": r.agentes, "llamadas": r.llamadas,
        "atendidas": r.atendidas, "pct_contacto": r.pct_contacto, "pct_conversacion": r.pct_conversacion,
        "banda": r.banda, "jornada_media": r.jornada_media, "alertas": r.alertas,
    }


def _corte_dict(c: ProdCorte) -> dict[str, Any]:
    local = a_local(c.corte_at)
    return {
        "id": c.id, "fecha": c.fecha.isoformat(), "hora": local.strftime("%H:%M"), "corte_at": _iso(c.corte_at),
        "hora_origen": c.hora_origen, "archivo": c.filename, "agentes": c.agentes, "llamadas": c.llamadas,
        "umbrales_cortas": [int(u) for u in (c.umbrales_cortas or "").split(",") if u.isdigit()], "uploaded_by": c.uploaded_by, "uploaded_at": _iso(c.uploaded_at),
    }


async def _cortes_del_dia(db: AsyncSession, fecha: date) -> list[ProdCorte]:
    rows = await db.execute(select(ProdCorte).where(ProdCorte.fecha == fecha))
    return sorted(rows.scalars().all(), key=lambda c: _utc(c.corte_at))


def _para_analisis(c: ProdCorte) -> dict[str, Any]:
    reporte = parse_tiempos(gzip.decompress(c.contenido_gz))
    return {"id": c.id, "hora": a_local(c.corte_at), "archivo": c.filename,
            "filas": reporte["filas"], "umbrales": reporte["umbrales"]}


def _aplicar(informe: ProdInforme, data: dict[str, Any], user_id: str) -> None:
    informe.data = data
    informe.generated_at = datetime.now(timezone.utc)
    informe.generated_by = user_id
    for k, v in resumen_lista(data).items():
        setattr(informe, k, v)


async def _actualizar_borrador(db: AsyncSession, fecha: date, user_id: str) -> ProdInforme | None:
    """Rehace el borrador del día con todos sus cortes (lo crea si no hay). Sin cortes, lo elimina."""
    cortes = await _cortes_del_dia(db, fecha)
    borrador = (await db.execute(
        select(ProdInforme).where(ProdInforme.fecha == fecha, ProdInforme.status == ESTADO_BORRADOR)
        .order_by(ProdInforme.generated_at.desc())
    )).scalars().first()
    if not cortes:
        if borrador:
            await db.delete(borrador)
        return None
    data = analizar_dia(fecha, [_para_analisis(c) for c in cortes], await parametros(db))
    if not borrador:
        borrador = ProdInforme(fecha=fecha, status=ESTADO_BORRADOR)
        db.add(borrador)
    _aplicar(borrador, data, user_id)
    return borrador


async def _informe_visible(db: AsyncSession, informe_id: str, user: CurrentUser) -> ProdInforme:
    """Gestión ve todo; el resto solo lo publicado."""
    r = await db.get(ProdInforme, informe_id)
    if not r or (r.status != ESTADO_PUBLICADO and not user.has_perm(PERM_GESTION)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Informe no encontrado")
    return r


# ------------------------------------------------------------------ parámetros
class ParametrosPayload(BaseModel):
    parametros: dict[str, Any]


@router.get("/parametros")
async def ver_parametros(user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    fila = await db.get(ProdParametros, 1)
    nombres = await _nombres(db, {fila.updated_by if fila else None})
    return {
        "parametros": await parametros(db),
        "defecto": PARAMETROS_DEFECTO,
        "puede_editar": user.is_superadmin,
        "actualizado": {"en": _iso(fila.updated_at) if fila else None,
                        "por": nombres.get(fila.updated_by or "", fila.updated_by) if fila else None},
    }


@router.put("/parametros")
async def guardar_parametros(payload: ParametrosPayload, request: Request,
                             user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    if not user.is_superadmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo el superadmin cambia las metas del módulo")
    try:
        p = validar_parametros(payload.parametros)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    fila = await db.get(ProdParametros, 1)
    anterior = dict(fila.data) if fila else {}
    if not fila:
        fila = ProdParametros(id=1)
        db.add(fila)
    fila.data, fila.updated_at, fila.updated_by = p, datetime.now(timezone.utc), user.id
    await db.commit()
    await record_action(db, user_id=user.id, action="prod_llamadas_parametros", resource_type="prod_llamadas",
                        ip=client_ip(request), extra={"antes": anterior, "despues": p})
    return await ver_parametros(user, db)


# ------------------------------------------------------------------ cortes
@router.post("/cortes", status_code=status.HTTP_201_CREATED)
async def subir_corte(
    request: Request,
    file: UploadFile = File(..., description="Reporte Tiempos Acumulados de la plataforma (.csv)"),
    fecha_hora: Optional[str] = Form(None, description="Solo si el nombre no trae la marca de tiempo: 'YYYY-MM-DDTHH:MM' (hora de Asunción)"),
    user: CurrentUser = Depends(require_gestion),
    db: AsyncSession = Depends(get_db),
) -> dict:
    nombre = file.filename or ""
    if not nombre.lower().endswith(".csv"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Se espera el reporte de tiempos en .csv")
    contenido = await file.read(MAX_CSV_BYTES + 1)
    if len(contenido) > MAX_CSV_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "El archivo supera 2 MB: no parece el reporte diario por agente")
    try:
        reporte = parse_tiempos(contenido)
    except ArchivoInvalido as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    momento, origen = corte_de_nombre(nombre), "archivo"
    if momento is None:
        if not fecha_hora:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, {
                "code": "sin_fecha",
                "message": "El nombre del archivo no trae la fecha y hora del corte: indicalas para subirlo.",
            })
        try:
            momento = datetime.fromisoformat(fecha_hora).replace(tzinfo=ZONA)
        except ValueError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Fecha y hora inválidas (formato YYYY-MM-DDTHH:MM)") from exc
        origen = "manual"
    local = a_local(momento)
    if local > datetime.now(ZONA) + timedelta(minutes=10):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"El corte es del {local:%d/%m/%Y %H:%M}: una fecha futura no es válida.")
    fecha, corte_at = local.date(), local.astimezone(timezone.utc)

    async with _lock_dia:
        existente = next((c for c in await _cortes_del_dia(db, fecha) if _utc(c.corte_at) == corte_at), None)
        corte = existente or ProdCorte(fecha=fecha, corte_at=corte_at, uploaded_by=user.id)
        corte.hora_origen, corte.filename = origen, nombre[:500]
        corte.sha256 = hashlib.sha256(contenido).hexdigest()
        corte.contenido_gz = gzip.compress(contenido)
        corte.agentes = sum(1 for f in reporte["filas"] if f.get("login", 0) > 0)
        corte.llamadas = sum(f.get("llamadas", 0) for f in reporte["filas"])
        corte.umbrales_cortas = ",".join(str(u) for u in reporte["umbrales"] if u is not None) or None
        corte.uploaded_by, corte.uploaded_at = user.id, datetime.now(timezone.utc)
        if not existente:
            db.add(corte)
        await db.flush()
        informe = await _actualizar_borrador(db, fecha, user.id)
        await db.commit()
        await db.refresh(corte)

    await record_action(db, user_id=user.id, action="prod_llamadas_corte", resource_type="prod_llamadas_corte",
                        resource_id=corte.id, ip=client_ip(request),
                        extra={"archivo": nombre, "fecha": fecha.isoformat(), "hora": local.strftime("%H:%M"),
                               "reemplaza": bool(existente)})
    return {"corte": _corte_dict(corte), "reemplazo": bool(existente),
            "informe": _resumen(informe) if informe else None}


@router.get("/cortes")
async def listar_cortes(fecha: date, user: CurrentUser = Depends(require_gestion), db: AsyncSession = Depends(get_db)) -> dict:
    cortes = await _cortes_del_dia(db, fecha)
    nombres = await _nombres(db, {c.uploaded_by for c in cortes})
    return {"items": [_corte_dict(c) for c in cortes], "usuarios": nombres}


@router.delete("/cortes/{corte_id}")
async def eliminar_corte(corte_id: str, request: Request, user: CurrentUser = Depends(require_gestion),
                         db: AsyncSession = Depends(get_db)) -> dict:
    async with _lock_dia:
        corte = await db.get(ProdCorte, corte_id)
        if not corte:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Corte no encontrado")
        fecha, hora = corte.fecha, a_local(corte.corte_at).strftime("%H:%M")
        await db.delete(corte)
        await db.flush()
        informe = await _actualizar_borrador(db, fecha, user.id)
        await db.commit()
    await record_action(db, user_id=user.id, action="prod_llamadas_corte_eliminado", resource_type="prod_llamadas_corte",
                        resource_id=corte_id, ip=client_ip(request), extra={"fecha": fecha.isoformat(), "hora": hora})
    return {"status": "deleted", "informe": _resumen(informe) if informe else None}


# ------------------------------------------------------------------ informes diarios
@router.get("/informes")
async def listar_informes(user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    q = select(ProdInforme)
    if not user.has_perm(PERM_GESTION):
        q = q.where(ProdInforme.status == ESTADO_PUBLICADO)
    rows = (await db.execute(q.order_by(ProdInforme.fecha.desc(), ProdInforme.generated_at.desc()).limit(800))).scalars().all()
    nombres = await _nombres(db, {r.published_by for r in rows} | {r.generated_by for r in rows})
    return {"items": [_resumen(r) for r in rows], "total": len(rows), "usuarios": nombres}


@router.get("/informes/{informe_id}")
async def ver_informe(informe_id: str, request: Request, user: CurrentUser = Depends(require_ver),
                      db: AsyncSession = Depends(get_db)) -> dict:
    r = await _informe_visible(db, informe_id, user)
    vigentes = await parametros(db)
    out = {**_resumen(r), "data": r.data,
           "parametros_vigentes": vigentes,
           "parametros_distintos": (r.data or {}).get("parametros") != vigentes,
           "version_actual": VERSION_ANALISIS}
    if user.has_perm(PERM_GESTION):
        cortes = await _cortes_del_dia(db, r.fecha)
        nombres = await _nombres(db, {c.uploaded_by for c in cortes} | {r.generated_by, r.published_by})
        out["cortes_del_dia"] = [_corte_dict(c) for c in cortes]
        # El día tiene cortes que este informe no incluye (p. ej. se subió uno nuevo después de publicar).
        usados = {c.get("id") for c in (r.data or {}).get("cortes", [])}
        out["cortes_nuevos"] = sum(1 for c in cortes if c.id not in usados)
        out["usuarios"] = nombres
    else:
        out["usuarios"] = await _nombres(db, {r.published_by})
    await record_action(db, user_id=user.id, action="view_prod_llamadas_informe", resource_type="prod_llamadas_informe",
                        resource_id=informe_id, ip=client_ip(request))
    return out


class PublicarPayload(BaseModel):
    confirm_replace: bool = False


@router.post("/informes/{informe_id}/publicar")
async def publicar(informe_id: str, payload: PublicarPayload, request: Request,
                   user: CurrentUser = Depends(require_gestion), db: AsyncSession = Depends(get_db)) -> dict:
    r = await db.get(ProdInforme, informe_id)
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Informe no encontrado")
    if r.status == ESTADO_PUBLICADO:
        return _resumen(r)
    actual = (await db.execute(select(ProdInforme).where(
        ProdInforme.fecha == r.fecha, ProdInforme.status == ESTADO_PUBLICADO))).scalars().first()
    if actual and not payload.confirm_replace:
        nombres = await _nombres(db, {actual.published_by})
        raise HTTPException(status.HTTP_409_CONFLICT, detail={
            "code": "replace_required",
            "message": f"El {r.fecha:%d/%m/%Y} ya tiene un informe publicado. Si continuás, lo reemplaza.",
            "existing": {**_resumen(actual), "published_by": nombres.get(actual.published_by or "", actual.published_by)},
        })
    ahora = datetime.now(timezone.utc)
    if actual:
        actual.status, actual.replaced_at, actual.replaced_by_report_id = ESTADO_REEMPLAZADO, ahora, r.id
    r.status, r.published_at, r.published_by = ESTADO_PUBLICADO, ahora, user.id
    await db.commit()
    await db.refresh(r)
    await record_action(db, user_id=user.id,
                        action="prod_llamadas_reemplazado" if actual else "prod_llamadas_publicado",
                        resource_type="prod_llamadas_informe", resource_id=informe_id, ip=client_ip(request),
                        extra={"fecha": r.fecha.isoformat(), "reemplaza_a": actual.id if actual else None})
    return _resumen(r)


@router.post("/informes/{informe_id}/despublicar")
async def despublicar(informe_id: str, request: Request, user: CurrentUser = Depends(require_gestion),
                      db: AsyncSession = Depends(get_db)) -> dict:
    r = await db.get(ProdInforme, informe_id)
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Informe no encontrado")
    if r.status != ESTADO_PUBLICADO:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El informe no está publicado")
    r.status, r.published_at, r.published_by = ESTADO_BORRADOR, None, None
    await db.commit()
    await db.refresh(r)
    await record_action(db, user_id=user.id, action="prod_llamadas_despublicado", resource_type="prod_llamadas_informe",
                        resource_id=informe_id, ip=client_ip(request), extra={"fecha": r.fecha.isoformat()})
    return _resumen(r)


@router.post("/informes/{informe_id}/recalcular")
async def recalcular(informe_id: str, request: Request, user: CurrentUser = Depends(require_gestion),
                     db: AsyncSession = Depends(get_db)) -> dict:
    """Rehace el día con sus cortes y los parámetros vigentes.

    Un borrador se recalcula en el lugar. Un informe publicado no cambia nunca: se
    genera (o actualiza) el borrador del día, que después se publica en su lugar.
    """
    r = await db.get(ProdInforme, informe_id)
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Informe no encontrado")
    async with _lock_dia:
        if not await _cortes_del_dia(db, r.fecha):
            raise HTTPException(status.HTTP_409_CONFLICT, "El día ya no tiene cortes guardados: no se puede recalcular.")
        borrador = await _actualizar_borrador(db, r.fecha, user.id)
        await db.commit()
        await db.refresh(borrador)
    await record_action(db, user_id=user.id, action="prod_llamadas_recalculado", resource_type="prod_llamadas_informe",
                        resource_id=borrador.id, ip=client_ip(request),
                        extra={"fecha": r.fecha.isoformat(), "desde_informe": informe_id})
    return {"informe": _resumen(borrador), "nuevo_borrador": borrador.id != r.id}


@router.delete("/informes/{informe_id}")
async def eliminar_informe(informe_id: str, request: Request, user: CurrentUser = Depends(require_gestion),
                           db: AsyncSession = Depends(get_db)) -> dict:
    r = await db.get(ProdInforme, informe_id)
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Informe no encontrado")
    if r.status == ESTADO_PUBLICADO:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El informe está publicado: despublicalo antes de eliminarlo")
    fecha, estado = r.fecha, r.status
    await db.delete(r)
    await db.commit()
    await record_action(db, user_id=user.id, action="prod_llamadas_eliminado", resource_type="prod_llamadas_informe",
                        resource_id=informe_id, ip=client_ip(request), extra={"fecha": fecha.isoformat(), "status": estado})
    return {"status": "deleted"}


# ------------------------------------------------------------------ acumulado
@router.get("/acumulado")
async def acumulado(
    desde: date = Query(...), hasta: date = Query(...),
    user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db),
) -> dict:
    """Semana, mes o rango: suma de los días PUBLICADOS (con los parámetros vigentes)."""
    if hasta < desde:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La fecha final es anterior a la inicial")
    if (hasta - desde).days + 1 > MAX_DIAS_ACUMULADO:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"El rango puede tener hasta {MAX_DIAS_ACUMULADO} días")
    publicados = (await db.execute(select(ProdInforme).where(
        ProdInforme.status == ESTADO_PUBLICADO, ProdInforme.fecha >= desde, ProdInforme.fecha <= hasta,
    ))).scalars().all()
    dias = [{**r.data, "informe_id": r.id} for r in publicados if r.data]
    out = acumular(dias, await parametros(db)) if dias else None
    pendientes: list[str] = []
    if user.has_perm(PERM_GESTION):
        borradores = (await db.execute(select(ProdInforme.fecha).where(
            ProdInforme.status == ESTADO_BORRADOR, ProdInforme.fecha >= desde, ProdInforme.fecha <= hasta,
        ))).scalars().all()
        con_publicacion = {r.fecha for r in publicados}
        pendientes = sorted({f.isoformat() for f in borradores if f not in con_publicacion})
    return {"desde": desde.isoformat(), "hasta": hasta.isoformat(), "acumulado": out, "pendientes_publicar": pendientes,
            "ultimo_publicado": await _ultimo_publicado(db)}


async def _ultimo_publicado(db: AsyncSession) -> str | None:
    f = (await db.execute(select(ProdInforme.fecha).where(ProdInforme.status == ESTADO_PUBLICADO)
                          .order_by(ProdInforme.fecha.desc()).limit(1))).scalars().first()
    return f.isoformat() if f else None
