"""API del SPH estimado — Televentas Claro.

Permisos:
* `televentas_claro.sph`          → ver los informes SPH PUBLICADOS.
* `televentas_claro.sph_gestion`  → calcular, ver borradores, publicar, reemplazar, recalcular,
                                    eliminar y vincular agentes con vendedores a mano.

Fuentes (no se sube nada nuevo): el informe de Productividad del día y el de Ventas Netas del
mes de ese día. De cada uno se usa el publicado; si no hay, el borrador más reciente (queda
avisado en el informe). El SPH queda congelado con los datos del momento en que se calculó.

Circuito (el mismo de Productividad): "Calcular" crea o rehace el borrador del día; como máximo
hay un SPH publicado por día. Publicar sobre un día que ya tiene uno exige `confirm_replace=True`
(si no, 409 con los datos del publicado). Un publicado no cambia: recalcular genera otro borrador.
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import CurrentUser, client_ip, require_perm
from ....core.config import settings
from ....core.database import get_db
from ....models.user import User
from ....services.audit_service import record_action
from ..productividad.models import ESTADO_BORRADOR as PROD_BORRADOR
from ..productividad.models import ESTADO_PUBLICADO as PROD_PUBLICADO
from ..productividad.models import ProdInforme
from ..ventas_netas.models import ESTADO_BORRADOR as VN_BORRADOR
from ..ventas_netas.models import ESTADO_PUBLICADO as VN_PUBLICADO
from ..ventas_netas.models import VentasNetasReport
from .analyzer import VERSION_SPH, DatosIncompletos, calcular, resumen_lista
from .models import ESTADO_BORRADOR, ESTADO_PUBLICADO, ESTADO_REEMPLAZADO, SphInforme, SphVinculo

PERM_VER = "televentas_claro.sph"
PERM_GESTION = "televentas_claro.sph_gestion"
require_ver = require_perm(PERM_VER)
require_gestion = require_perm(PERM_GESTION)

router = APIRouter(prefix="/televentas-claro/sph", tags=["televentas-claro · sph"])

DIAS_DISPONIBLES = 62
# Un solo proceso atiende la API: este lock evita dos borradores del mismo día por cálculos simultáneos.
_lock = asyncio.Lock()


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


def _resumen(r: SphInforme) -> dict[str, Any]:
    return {
        "id": r.id, "fecha": r.fecha.isoformat(), "status": r.status,
        "generated_at": _iso(r.generated_at), "generated_by": r.generated_by,
        "published_at": _iso(r.published_at), "published_by": r.published_by,
        "replaced_at": _iso(r.replaced_at), "replaced_by_report_id": r.replaced_by_report_id,
        "sph": r.sph, "netas": r.netas, "horas": r.horas, "agentes": r.agentes, "vinculados": r.vinculados,
        "pct_cobertura": r.pct_cobertura, "pct_activadas": r.pct_activadas,
        "ventas_corte": r.ventas_corte.isoformat() if r.ventas_corte else None,
    }


async def _informe_productividad(db: AsyncSession, fecha: date) -> ProdInforme | None:
    """El publicado del día; si no hay, el borrador más reciente."""
    rows = (await db.execute(select(ProdInforme).where(
        ProdInforme.fecha == fecha, ProdInforme.status.in_([PROD_PUBLICADO, PROD_BORRADOR]),
    ))).scalars().all()
    publicados = [r for r in rows if r.status == PROD_PUBLICADO]
    if publicados:
        return publicados[0]
    return max(rows, key=lambda r: _utc(r.generated_at) or datetime.min.replace(tzinfo=timezone.utc), default=None)


async def _informes_ventas(db: AsyncSession, periodos: set[str]) -> dict[str, VentasNetasReport]:
    """Por período: el publicado; si no hay, el borrador con el corte más reciente."""
    if not periodos:
        return {}
    rows = (await db.execute(select(VentasNetasReport).where(
        VentasNetasReport.periodo.in_(periodos), VentasNetasReport.status.in_([VN_PUBLICADO, VN_BORRADOR]),
    ))).scalars().all()
    out: dict[str, VentasNetasReport] = {}
    for r in sorted(rows, key=lambda r: (r.status == VN_PUBLICADO, r.fecha_dato or date.min,
                                         _utc(r.generated_at) or datetime.min.replace(tzinfo=timezone.utc))):
        out[r.periodo] = r  # queda el mejor: publicado > corte más nuevo > generado más tarde
    return out


def _desc_prod(r: ProdInforme) -> dict[str, Any]:
    return {"id": r.id, "status": r.status, "fecha": r.fecha.isoformat(), "corte_final": r.corte_final,
            "agentes": r.agentes, "generated_at": _iso(r.generated_at)}


def _desc_ventas(r: VentasNetasReport) -> dict[str, Any]:
    return {"id": r.id, "status": r.status, "periodo": r.periodo,
            "fecha_dato": r.fecha_dato.isoformat() if r.fecha_dato else None, "netas": r.netas,
            "generated_at": _iso(r.generated_at)}


def _motivo(fecha: date, prod: ProdInforme | None, ventas: VentasNetasReport | None) -> str | None:
    """Por qué no se puede calcular el SPH del día (None si se puede)."""
    if fecha > date.today() + timedelta(days=1):
        return "La fecha es futura."
    if not prod:
        return f"No hay informe de Productividad del {fecha:%d/%m/%Y}: subí los cortes de llamadas de ese día."
    if not ventas:
        return f"No hay informe de Ventas Netas de {fecha:%m/%Y}: subí un corte de ventas de ese mes."
    if ventas.fecha_dato and ventas.fecha_dato < fecha:
        return (f"El corte de ventas de {fecha:%m/%Y} es del {ventas.fecha_dato:%d/%m}: todavía no trae las ventas del "
                f"{fecha:%d/%m}. Subí un corte de ventas posterior.")
    return None


async def _fuentes(db: AsyncSession, fecha: date) -> tuple[ProdInforme | None, VentasNetasReport | None, str | None]:
    prod = await _informe_productividad(db, fecha)
    ventas = (await _informes_ventas(db, {fecha.strftime("%Y-%m")})).get(fecha.strftime("%Y-%m"))
    return prod, ventas, _motivo(fecha, prod, ventas)


async def _manuales(db: AsyncSession) -> dict[str, str | None]:
    return {v.clave: v.vendedor for v in (await db.execute(select(SphVinculo))).scalars().all()}


async def _calcular_borrador(db: AsyncSession, fecha: date, user_id: str) -> SphInforme:
    """Calcula el SPH del día y lo deja en su borrador (lo crea si no hay). No hace commit."""
    prod, ventas, motivo = await _fuentes(db, fecha)
    if motivo:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "sin_fuente", "message": motivo})
    fuentes = {"productividad": _desc_prod(prod), "ventas": _desc_ventas(ventas)}
    try:  # el cruce por nombre compara cientos de pares: fuera del loop del servidor
        data = await asyncio.to_thread(calcular, fecha, prod.data or {}, ventas.data or {}, fuentes, await _manuales(db))
    except DatosIncompletos as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "datos_incompletos", "message": str(exc)}) from exc
    borrador = (await db.execute(
        select(SphInforme).where(SphInforme.fecha == fecha, SphInforme.status == ESTADO_BORRADOR)
        .order_by(SphInforme.generated_at.desc())
    )).scalars().first()
    if not borrador:
        borrador = SphInforme(fecha=fecha, status=ESTADO_BORRADOR)
        db.add(borrador)
    borrador.data = data
    borrador.generated_at, borrador.generated_by = datetime.now(timezone.utc), user_id
    borrador.prod_informe_id, borrador.ventas_report_id, borrador.ventas_corte = prod.id, ventas.id, ventas.fecha_dato
    for k, v in resumen_lista(data).items():
        setattr(borrador, k, v)
    return borrador


async def _informe_visible(db: AsyncSession, informe_id: str, user: CurrentUser) -> SphInforme:
    """Gestión ve todo; el resto solo lo publicado."""
    r = await db.get(SphInforme, informe_id)
    if not r or (r.status != ESTADO_PUBLICADO and not user.has_perm(PERM_GESTION)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Informe no encontrado")
    return r


# ------------------------------------------------------------------ fuentes y días disponibles
@router.get("/fuentes")
async def ver_fuentes(fecha: date, user: CurrentUser = Depends(require_gestion), db: AsyncSession = Depends(get_db)) -> dict:
    """Qué informes se usarían para calcular el SPH del día y si se puede."""
    prod, ventas, motivo = await _fuentes(db, fecha)
    sph = (await db.execute(select(SphInforme).where(SphInforme.fecha == fecha, SphInforme.status.in_(
        [ESTADO_BORRADOR, ESTADO_PUBLICADO])))).scalars().all()
    return {
        "fecha": fecha.isoformat(),
        "productividad": _desc_prod(prod) if prod else None,
        "ventas": _desc_ventas(ventas) if ventas else None,
        "puede_calcular": motivo is None, "motivo": motivo,
        "sph": {s.status: s.id for s in sph},
    }


@router.get("/dias")
async def dias_disponibles(user: CurrentUser = Depends(require_gestion), db: AsyncSession = Depends(get_db)) -> dict:
    """Días recientes con informe de Productividad: si las ventas los cubren y si ya tienen SPH."""
    desde = date.today() - timedelta(days=DIAS_DISPONIBLES)
    prod = (await db.execute(select(ProdInforme.fecha, ProdInforme.status).where(
        ProdInforme.fecha >= desde, ProdInforme.status.in_([PROD_PUBLICADO, PROD_BORRADOR]),
    ))).all()
    estado_prod: dict[date, str] = {}
    for f, s in prod:
        if estado_prod.get(f) != PROD_PUBLICADO:
            estado_prod[f] = s
    ventas = await _informes_ventas(db, {f.strftime("%Y-%m") for f in estado_prod})
    sph = (await db.execute(select(SphInforme.fecha, SphInforme.status, SphInforme.id).where(
        SphInforme.fecha >= desde, SphInforme.status.in_([ESTADO_BORRADOR, ESTADO_PUBLICADO]),
    ))).all()
    estado_sph: dict[date, dict[str, str]] = {}
    for f, s, i in sph:
        estado_sph.setdefault(f, {})[s] = i
    dias = []
    for f in sorted(estado_prod, reverse=True):
        v = ventas.get(f.strftime("%Y-%m"))
        dias.append({
            "fecha": f.isoformat(), "productividad": estado_prod[f],
            "ventas": v.status if v else None, "ventas_corte": v.fecha_dato.isoformat() if v and v.fecha_dato else None,
            "cubre": bool(v) and (v.fecha_dato is None or v.fecha_dato >= f),
            "sph": estado_sph.get(f, {}),
        })
    sugerida = next((d["fecha"] for d in dias if d["cubre"] and "published" not in d["sph"]), None)
    return {"dias": dias, "sugerida": sugerida}


# ------------------------------------------------------------------ calcular
class CalcularPayload(BaseModel):
    fecha: date


@router.post("/calcular", status_code=status.HTTP_201_CREATED)
async def calcular_sph(payload: CalcularPayload, request: Request, user: CurrentUser = Depends(require_gestion),
                       db: AsyncSession = Depends(get_db)) -> dict:
    async with _lock:
        informe = await _calcular_borrador(db, payload.fecha, user.id)
        await db.commit()
        await db.refresh(informe)
    await record_action(db, user_id=user.id, action="sph_calculado", resource_type="sph_informe",
                        resource_id=informe.id, ip=client_ip(request),
                        extra={"fecha": payload.fecha.isoformat(), "sph": informe.sph, "netas": informe.netas})
    return {"informe": _resumen(informe)}


# ------------------------------------------------------------------ informes
@router.get("/informes")
async def listar_informes(user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    q = select(SphInforme)
    if not user.has_perm(PERM_GESTION):
        q = q.where(SphInforme.status == ESTADO_PUBLICADO)
    rows = (await db.execute(q.order_by(SphInforme.fecha.desc(), SphInforme.generated_at.desc()).limit(800))).scalars().all()
    nombres = await _nombres(db, {r.published_by for r in rows} | {r.generated_by for r in rows})
    return {"items": [_resumen(r) for r in rows], "total": len(rows), "usuarios": nombres}


@router.get("/informes/{informe_id}")
async def ver_informe(informe_id: str, request: Request, user: CurrentUser = Depends(require_ver),
                      db: AsyncSession = Depends(get_db)) -> dict:
    r = await _informe_visible(db, informe_id, user)
    out = {**_resumen(r), "data": r.data, "version_actual": VERSION_SPH}
    if user.has_perm(PERM_GESTION):
        # ¿Hay datos más nuevos que los usados? (otro informe de Productividad o un corte de ventas posterior)
        prod, ventas, _ = await _fuentes(db, r.fecha)
        usadas = (r.data or {}).get("fuentes") or {}
        out["fuentes_nuevas"] = [
            nombre for nombre, actual, usada in (
                ("Productividad", prod and prod.id, (usadas.get("productividad") or {}).get("id")),
                ("Ventas Netas", ventas and (ventas.id, ventas.fecha_dato and ventas.fecha_dato.isoformat()),
                 ((usadas.get("ventas") or {}).get("id"), (usadas.get("ventas") or {}).get("fecha_dato"))),
            ) if actual and actual != usada
        ]
        out["vinculos"] = await _manuales(db)
        out["usuarios"] = await _nombres(db, {r.generated_by, r.published_by})
    else:
        out["usuarios"] = await _nombres(db, {r.published_by})
    await record_action(db, user_id=user.id, action="view_sph_informe", resource_type="sph_informe",
                        resource_id=informe_id, ip=client_ip(request))
    return out


class PublicarPayload(BaseModel):
    confirm_replace: bool = False


@router.post("/informes/{informe_id}/publicar")
async def publicar(informe_id: str, payload: PublicarPayload, request: Request,
                   user: CurrentUser = Depends(require_gestion), db: AsyncSession = Depends(get_db)) -> dict:
    r = await db.get(SphInforme, informe_id)
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Informe no encontrado")
    if r.status == ESTADO_PUBLICADO:
        return _resumen(r)
    actual = (await db.execute(select(SphInforme).where(
        SphInforme.fecha == r.fecha, SphInforme.status == ESTADO_PUBLICADO))).scalars().first()
    if actual and not payload.confirm_replace:
        nombres = await _nombres(db, {actual.published_by})
        raise HTTPException(status.HTTP_409_CONFLICT, detail={
            "code": "replace_required",
            "message": f"El {r.fecha:%d/%m/%Y} ya tiene un SPH publicado. Si continuás, lo reemplaza.",
            "existing": {**_resumen(actual), "published_by": nombres.get(actual.published_by or "", actual.published_by)},
        })
    ahora = datetime.now(timezone.utc)
    if actual:
        actual.status, actual.replaced_at, actual.replaced_by_report_id = ESTADO_REEMPLAZADO, ahora, r.id
    r.status, r.published_at, r.published_by = ESTADO_PUBLICADO, ahora, user.id
    await db.commit()
    await db.refresh(r)
    await record_action(db, user_id=user.id, action="sph_reemplazado" if actual else "sph_publicado",
                        resource_type="sph_informe", resource_id=informe_id, ip=client_ip(request),
                        extra={"fecha": r.fecha.isoformat(), "reemplaza_a": actual.id if actual else None})
    return _resumen(r)


@router.post("/informes/{informe_id}/despublicar")
async def despublicar(informe_id: str, request: Request, user: CurrentUser = Depends(require_gestion),
                      db: AsyncSession = Depends(get_db)) -> dict:
    r = await db.get(SphInforme, informe_id)
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Informe no encontrado")
    if r.status != ESTADO_PUBLICADO:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El informe no está publicado")
    r.status, r.published_at, r.published_by = ESTADO_BORRADOR, None, None
    await db.commit()
    await db.refresh(r)
    await record_action(db, user_id=user.id, action="sph_despublicado", resource_type="sph_informe",
                        resource_id=informe_id, ip=client_ip(request), extra={"fecha": r.fecha.isoformat()})
    return _resumen(r)


@router.post("/informes/{informe_id}/recalcular")
async def recalcular(informe_id: str, request: Request, user: CurrentUser = Depends(require_gestion),
                     db: AsyncSession = Depends(get_db)) -> dict:
    """Rehace el SPH del día con las fuentes y los vínculos vigentes.

    Un borrador se recalcula en el lugar. Un publicado no cambia nunca: se genera (o actualiza)
    el borrador del día, que después se publica en su lugar.
    """
    r = await db.get(SphInforme, informe_id)
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Informe no encontrado")
    async with _lock:
        borrador = await _calcular_borrador(db, r.fecha, user.id)
        await db.commit()
        await db.refresh(borrador)
    await record_action(db, user_id=user.id, action="sph_recalculado", resource_type="sph_informe",
                        resource_id=borrador.id, ip=client_ip(request),
                        extra={"fecha": r.fecha.isoformat(), "desde_informe": informe_id})
    return {"informe": _resumen(borrador), "nuevo_borrador": borrador.id != r.id}


@router.delete("/informes/{informe_id}")
async def eliminar_informe(informe_id: str, request: Request, user: CurrentUser = Depends(require_gestion),
                           db: AsyncSession = Depends(get_db)) -> dict:
    r = await db.get(SphInforme, informe_id)
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Informe no encontrado")
    if r.status == ESTADO_PUBLICADO:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El informe está publicado: despublicalo antes de eliminarlo")
    fecha, estado = r.fecha, r.status
    await db.delete(r)
    await db.commit()
    await record_action(db, user_id=user.id, action="sph_eliminado", resource_type="sph_informe",
                        resource_id=informe_id, ip=client_ip(request), extra={"fecha": fecha.isoformat(), "status": estado})
    return {"status": "deleted"}


# ------------------------------------------------------------------ vínculos manuales
@router.get("/vinculos")
async def listar_vinculos(user: CurrentUser = Depends(require_gestion), db: AsyncSession = Depends(get_db)) -> dict:
    rows = (await db.execute(select(SphVinculo).order_by(SphVinculo.nombre))).scalars().all()
    nombres = await _nombres(db, {v.updated_by for v in rows})
    return {"items": [{"clave": v.clave, "nombre": v.nombre, "vendedor": v.vendedor, "updated_at": _iso(v.updated_at),
                       "updated_by": nombres.get(v.updated_by or "", v.updated_by)} for v in rows]}


class VinculoPayload(BaseModel):
    clave: str = Field(..., min_length=1, max_length=200)
    nombre: str = Field(..., min_length=1, max_length=200)
    accion: Literal["vincular", "descartar", "automatico"]
    vendedor: Optional[str] = Field(None, max_length=200)


@router.put("/vinculos")
async def guardar_vinculo(payload: VinculoPayload, request: Request, user: CurrentUser = Depends(require_gestion),
                          db: AsyncSession = Depends(get_db)) -> dict:
    """vincular → este agente es ese vendedor · descartar → no es ninguno · automatico → vuelve al cruce por nombre."""
    clave, vendedor = payload.clave.strip(), (payload.vendedor or "").strip() or None
    actual = await db.get(SphVinculo, clave)
    antes = actual.vendedor if actual else "automatico"
    if payload.accion == "automatico":
        if actual:
            await db.delete(actual)
    else:
        if payload.accion == "vincular":
            if not vendedor:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Elegí el vendedor a vincular")
            otro = (await db.execute(select(SphVinculo).where(
                SphVinculo.vendedor == vendedor, SphVinculo.clave != clave))).scalars().first()
            if otro:
                raise HTTPException(status.HTTP_409_CONFLICT, f"{vendedor} ya está vinculado a {otro.nombre}. Quitá ese vínculo primero.")
        else:
            vendedor = None
        if not actual:
            actual = SphVinculo(clave=clave)
            db.add(actual)
        actual.nombre, actual.vendedor = payload.nombre.strip(), vendedor
        actual.updated_at, actual.updated_by = datetime.now(timezone.utc), user.id
    await db.commit()
    await record_action(db, user_id=user.id, action="sph_vinculo", resource_type="sph_vinculo", resource_id=clave,
                        ip=client_ip(request), extra={"agente": clave, "accion": payload.accion, "antes": antes, "vendedor": vendedor})
    return {"clave": clave, "accion": payload.accion, "vendedor": vendedor}
