"""API de Auditoría de Ventas — Televentas Claro.

Permiso: `televentas_claro.auditoria` (Analista por defecto; el superadmin lo
asigna a otros perfiles). Quien lo tiene ve y trabaja todos los informes de
auditoría del equipo. Cada acción queda en el registro de auditoría general.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import CurrentUser, client_ip, require_perm
from ....core.config import settings
from ....core.database import get_db
from ....core.logging import logger
from ....models.user import User
from ....services.audit_service import record_action
from ..ventas_netas.jobs import ANALYSIS_VERSION, SinDatosGuardados, desactualizado, recalcular_informe, version_analisis
from ..ventas_netas.models import ESTADO_BORRADOR, ESTADO_PUBLICADO, VentasNetasReport
from .models import (
    ESTADOS, ESTADOS_CON_SEGUIMIENTO, ESTADOS_EDITABLES, HALLAZGO_ESTADO_LABEL, TRANSICIONES,
    Auditoria, AuditoriaHallazgo, AuditoriaSeguimiento,
)
from .schemas import (
    AuditoriaCreate, AuditoriaDetalle, AuditoriaLista, AuditoriaResumen, AuditoriaUpdate, EstadoRequest,
    FuenteDisponible, HallazgoCreate, HallazgoRead, HallazgoUpdate, RiesgosRequest, SeguimientoCreate, SeguimientoRead,
)
from .snapshot import construir_snapshot, hallazgos_automaticos, resumen_automatico

PERM = "televentas_claro.auditoria"
require_auditoria = require_perm(PERM)

router = APIRouter(prefix="/televentas-claro/auditoria", tags=["televentas-claro · auditoría"])

ESTADO_LABEL = {"borrador": "Borrador", "en_revision": "En revisión", "cerrado": "Cerrado", "archivado": "Archivado"}


async def _nombres(db: AsyncSession, ids: set[str | None]) -> dict[str, str]:
    ids = {i for i in ids if i}
    out = {"superadmin": settings.superadmin_name}
    if ids:
        rows = await db.execute(select(User.id, User.full_name).where(User.id.in_(ids)))
        out.update({i: n for i, n in rows.all()})
    return out


async def _get(db: AsyncSession, auditoria_id: str) -> Auditoria:
    a = await db.get(Auditoria, auditoria_id)
    if not a:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Informe de auditoría no encontrado")
    return a


def _exigir_editable(a: Auditoria) -> None:
    if a.status not in ESTADOS_EDITABLES:
        raise HTTPException(status.HTTP_409_CONFLICT, f"El informe está {ESTADO_LABEL[a.status].lower()}: no se puede modificar su contenido. Reabrilo para editarlo.")


def _exigir_seguimiento(a: Auditoria) -> None:
    if a.status not in ESTADOS_CON_SEGUIMIENTO:
        raise HTTPException(status.HTTP_409_CONFLICT, "El informe está archivado: solo lectura.")


def _historial(a: Auditoria, user: CurrentUser, accion: str, detalle: str | None = None) -> None:
    a.historial = [*(a.historial or []), {
        "fecha": datetime.utcnow().isoformat(timespec="seconds") + "Z", "usuario": user.id, "accion": accion, "detalle": detalle,
    }]


async def _cargar_fuentes(db: AsyncSession, report_ids: list[str], user: CurrentUser, request: Request) -> list[VentasNetasReport]:
    """Trae los informes de Ventas Netas elegidos como fuente.

    Si alguno fue generado por una versión anterior del análisis, se recalcula
    acá mismo a partir de los datos guardados (lo mismo que "Reprocesar" en
    Ventas Netas): la auditoría siempre trabaja con el análisis vigente sin que
    nadie tenga que volver a subir el archivo. Si no se puede (corte anterior a
    que se guardaran los datos y sin archivo), queda como está y el snapshot lo
    advierte.
    """
    ids = list(dict.fromkeys(report_ids))
    rows = (await db.execute(select(VentasNetasReport).where(VentasNetasReport.id.in_(ids)))).scalars().all()
    if len(rows) != len(ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alguno de los informes de Ventas Netas no existe")
    periodos = [r.periodo for r in rows]
    if len(set(periodos)) != len(periodos):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Elegí un solo informe por período: hay dos cortes del mismo mes seleccionados.")
    actualizados: list[tuple[VentasNetasReport, int]] = []
    for r in rows:
        if not desactualizado(r):
            continue
        anterior = version_analisis(r)
        try:
            await recalcular_informe(db, r)
        except SinDatosGuardados:
            logger.warning("Auditoría: fuente %s (%s) desactualizada (v%s) sin datos guardados; se usa como está", r.id, r.periodo, anterior)
            continue
        except Exception:  # noqa: BLE001 — la auditoría no se cae por una fuente que no se pudo recalcular
            logger.exception("Auditoría: no se pudo recalcular la fuente %s (%s)", r.id, r.periodo)
            await db.rollback()
            rows = (await db.execute(select(VentasNetasReport).where(VentasNetasReport.id.in_(ids)))).scalars().all()
            actualizados = []
            break
        actualizados.append((r, anterior))
    if actualizados:
        await db.commit()
        for r, anterior in actualizados:
            await db.refresh(r)
            await record_action(db, user_id=user.id, action="reprocess_ventas_netas_report", resource_type="ventas_netas_report", resource_id=r.id,
                                ip=client_ip(request), extra={"periodo": r.periodo, "version": ANALYSIS_VERSION, "anterior": anterior, "origen": "auditoria"})
    return rows


async def _detalle(db: AsyncSession, a: Auditoria, user: CurrentUser) -> AuditoriaDetalle:
    hallazgos = (await db.execute(
        select(AuditoriaHallazgo).where(AuditoriaHallazgo.auditoria_id == a.id).order_by(AuditoriaHallazgo.orden, AuditoriaHallazgo.created_at)
    )).scalars().all()
    seguimientos = (await db.execute(
        select(AuditoriaSeguimiento).where(AuditoriaSeguimiento.auditoria_id == a.id).order_by(AuditoriaSeguimiento.created_at.desc())
    )).scalars().all()
    ids = {a.created_by, a.updated_by, a.closed_by} | {h.created_by for h in hallazgos} | {h.updated_by for h in hallazgos} \
        | {s.created_by for s in seguimientos} | {h.get("usuario") for h in (a.historial or [])}
    base = AuditoriaResumen.model_validate(a).model_dump(exclude={"hallazgos_total", "hallazgos_abiertos", "hallazgos_alta"})
    return AuditoriaDetalle(
        **base,
        hallazgos_total=len(hallazgos),
        hallazgos_abiertos=sum(1 for h in hallazgos if h.estado in ("abierto", "en_seguimiento")),
        hallazgos_alta=sum(1 for h in hallazgos if h.severidad == "alta" and h.estado != "descartado"),
        alcance=a.alcance, resumen=a.resumen, conclusiones=a.conclusiones, recomendaciones=a.recomendaciones,
        snapshot=a.snapshot or {}, graficos=a.graficos or [], historial=a.historial or [],
        hallazgos=[HallazgoRead.model_validate(h) for h in hallazgos],
        seguimientos=[SeguimientoRead.model_validate(s) for s in seguimientos],
        usuarios=await _nombres(db, ids),
        editable=a.status in ESTADOS_EDITABLES,
        con_seguimiento=a.status in ESTADOS_CON_SEGUIMIENTO,
        transiciones=sorted(TRANSICIONES[a.status]),
        puede_eliminar=a.status == "borrador" and (a.created_by == user.id or user.is_superadmin),
    )


async def _siguiente_codigo(db: AsyncSession) -> str:
    year = datetime.utcnow().year
    n = (await db.execute(select(func.count()).select_from(Auditoria).where(Auditoria.codigo.like(f"AUD-{year}-%")))).scalar_one()
    return f"AUD-{year}-{n + 1:03d}"


# ============================ fuentes y riesgos ============================
@router.get("/fuentes", response_model=list[FuenteDisponible])
async def fuentes(user: CurrentUser = Depends(require_auditoria), db: AsyncSession = Depends(get_db)) -> list[FuenteDisponible]:
    """Informes de Ventas Netas disponibles como fuente (publicados y borradores; los reemplazados no)."""
    rows = (await db.execute(
        select(VentasNetasReport).where(VentasNetasReport.status.in_([ESTADO_PUBLICADO, ESTADO_BORRADOR])).order_by(VentasNetasReport.period_month.desc(), VentasNetasReport.fecha_dato.desc(), VentasNetasReport.generated_at.desc()).limit(200)
    )).scalars().all()
    return [
        FuenteDisponible.model_validate(r).model_copy(update={"analysis_version": version_analisis(r), "actualizada": not desactualizado(r)})
        for r in rows
    ]


@router.post("/riesgos")
async def riesgos(payload: RiesgosRequest, request: Request, user: CurrentUser = Depends(require_auditoria), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Análisis de riesgos en vivo sobre los informes elegidos (no se guarda)."""
    reports = await _cargar_fuentes(db, payload.report_ids, user, request)
    return construir_snapshot(reports)


# ============================ informes de auditoría ============================
@router.get("/informes", response_model=AuditoriaLista)
async def listar(user: CurrentUser = Depends(require_auditoria), db: AsyncSession = Depends(get_db)) -> AuditoriaLista:
    rows = (await db.execute(select(Auditoria).order_by(Auditoria.created_at.desc()).limit(500))).scalars().all()
    conteos = (await db.execute(
        select(AuditoriaHallazgo.auditoria_id, AuditoriaHallazgo.estado, AuditoriaHallazgo.severidad, func.count())
        .group_by(AuditoriaHallazgo.auditoria_id, AuditoriaHallazgo.estado, AuditoriaHallazgo.severidad)
    )).all()
    por_aud: dict[str, dict[str, int]] = {}
    for aid, estado, sev, n in conteos:
        c = por_aud.setdefault(aid, {"total": 0, "abiertos": 0, "alta": 0})
        c["total"] += n
        if estado in ("abierto", "en_seguimiento"):
            c["abiertos"] += n
        if sev == "alta" and estado != "descartado":
            c["alta"] += n
    items = []
    for a in rows:
        c = por_aud.get(a.id, {"total": 0, "abiertos": 0, "alta": 0})
        items.append(AuditoriaResumen(**AuditoriaResumen.model_validate(a).model_dump(exclude={"hallazgos_total", "hallazgos_abiertos", "hallazgos_alta"}),
                                      hallazgos_total=c["total"], hallazgos_abiertos=c["abiertos"], hallazgos_alta=c["alta"]))
    return AuditoriaLista(items=items, total=len(items), usuarios=await _nombres(db, {a.created_by for a in rows} | {a.closed_by for a in rows}))


@router.post("/informes", response_model=AuditoriaDetalle, status_code=status.HTTP_201_CREATED)
async def crear(payload: AuditoriaCreate, request: Request, user: CurrentUser = Depends(require_auditoria), db: AsyncSession = Depends(get_db)) -> AuditoriaDetalle:
    reports = await _cargar_fuentes(db, payload.report_ids, user, request)
    snapshot = construir_snapshot(reports)
    periodos = snapshot["periodos"]
    a = Auditoria(
        codigo=await _siguiente_codigo(db), titulo=payload.titulo.strip(), alcance=payload.alcance,
        periodo_desde=periodos[0], periodo_hasta=periodos[-1],
        resumen=resumen_automatico(snapshot),
        fuentes=snapshot["fuentes"], snapshot=snapshot,
        graficos=[{"key": "netas_por_dia"}, {"key": "sin_uso_por_vendedor"}, {"key": "sali_por_dia"}, {"key": "riesgo_uso"}],
        created_by=user.id,
    )
    _historial(a, user, "crear", f"{len(reports)} fuente(s): " + ", ".join(f"{r.periodo} corte {r.fecha_dato}" for r in reports))
    db.add(a)
    await db.flush()
    for i, h in enumerate(hallazgos_automaticos(snapshot), start=1):
        db.add(AuditoriaHallazgo(auditoria_id=a.id, orden=i, codigo=f"H-{i:02d}", origen="auto", created_by=user.id, **h))
    db.add(AuditoriaSeguimiento(auditoria_id=a.id, tipo="estado", texto="Informe creado en estado Borrador con los hallazgos automáticos.", created_by=user.id))
    await db.commit()
    await db.refresh(a)
    await record_action(db, user_id=user.id, action="create_auditoria", resource_type="auditoria", resource_id=a.id,
                        ip=client_ip(request), extra={"codigo": a.codigo, "fuentes": payload.report_ids})
    return await _detalle(db, a, user)


@router.get("/informes/{auditoria_id}", response_model=AuditoriaDetalle)
async def detalle(auditoria_id: str, user: CurrentUser = Depends(require_auditoria), db: AsyncSession = Depends(get_db)) -> AuditoriaDetalle:
    return await _detalle(db, await _get(db, auditoria_id), user)


@router.patch("/informes/{auditoria_id}", response_model=AuditoriaDetalle)
async def editar(auditoria_id: str, payload: AuditoriaUpdate, request: Request,
                 user: CurrentUser = Depends(require_auditoria), db: AsyncSession = Depends(get_db)) -> AuditoriaDetalle:
    a = await _get(db, auditoria_id)
    _exigir_editable(a)
    cambios = payload.model_dump(exclude_unset=True)
    if "graficos" in cambios and cambios["graficos"] is not None:
        cambios["graficos"] = [g.model_dump(exclude_none=True) for g in payload.graficos or []]
    for campo, valor in cambios.items():
        setattr(a, campo, valor.strip() if isinstance(valor, str) and campo == "titulo" else valor)
    a.updated_by, a.updated_at = user.id, datetime.utcnow()
    await db.commit()
    await record_action(db, user_id=user.id, action="update_auditoria", resource_type="auditoria", resource_id=a.id,
                        ip=client_ip(request), extra={"campos": sorted(cambios)})
    return await _detalle(db, a, user)


@router.post("/informes/{auditoria_id}/estado", response_model=AuditoriaDetalle)
async def cambiar_estado(auditoria_id: str, payload: EstadoRequest, request: Request,
                         user: CurrentUser = Depends(require_auditoria), db: AsyncSession = Depends(get_db)) -> AuditoriaDetalle:
    a = await _get(db, auditoria_id)
    if payload.status not in ESTADOS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Estado inválido: {payload.status}")
    if payload.status not in TRANSICIONES[a.status]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"No se puede pasar de {ESTADO_LABEL[a.status]} a {ESTADO_LABEL[payload.status]}.")
    anterior = a.status
    a.status = payload.status
    a.updated_by, a.updated_at = user.id, datetime.utcnow()
    if payload.status == "cerrado":
        a.closed_by, a.closed_at = user.id, datetime.utcnow()
    _historial(a, user, "estado", f"{ESTADO_LABEL[anterior]} → {ESTADO_LABEL[payload.status]}" + (f": {payload.nota}" if payload.nota else ""))
    db.add(AuditoriaSeguimiento(auditoria_id=a.id, tipo="estado", created_by=user.id,
                                texto=f"Estado: {ESTADO_LABEL[anterior]} → {ESTADO_LABEL[payload.status]}." + (f" {payload.nota}" if payload.nota else "")))
    await db.commit()
    await record_action(db, user_id=user.id, action="auditoria_estado", resource_type="auditoria", resource_id=a.id,
                        ip=client_ip(request), extra={"de": anterior, "a": payload.status, "nota": payload.nota})
    return await _detalle(db, a, user)


@router.delete("/informes/{auditoria_id}")
async def eliminar(auditoria_id: str, request: Request, user: CurrentUser = Depends(require_auditoria), db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    a = await _get(db, auditoria_id)
    if a.status != "borrador":
        raise HTTPException(status.HTTP_409_CONFLICT, "Solo se puede eliminar un informe en Borrador. Los demás se archivan.")
    if a.created_by != user.id and not user.is_superadmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo quien creó el borrador (o el superadmin) puede eliminarlo.")
    for h in (await db.execute(select(AuditoriaHallazgo).where(AuditoriaHallazgo.auditoria_id == a.id))).scalars().all():
        await db.delete(h)
    for s in (await db.execute(select(AuditoriaSeguimiento).where(AuditoriaSeguimiento.auditoria_id == a.id))).scalars().all():
        await db.delete(s)
    await db.delete(a)
    await db.commit()
    await record_action(db, user_id=user.id, action="delete_auditoria", resource_type="auditoria", resource_id=auditoria_id,
                        ip=client_ip(request), extra={"codigo": a.codigo})
    return {"status": "deleted"}


# ============================ hallazgos ============================
@router.post("/informes/{auditoria_id}/hallazgos", response_model=HallazgoRead, status_code=status.HTTP_201_CREATED)
async def crear_hallazgo(auditoria_id: str, payload: HallazgoCreate, request: Request,
                         user: CurrentUser = Depends(require_auditoria), db: AsyncSession = Depends(get_db)) -> AuditoriaHallazgo:
    a = await _get(db, auditoria_id)
    _exigir_editable(a)
    try:
        payload.validar()
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    n = (await db.execute(select(func.count()).select_from(AuditoriaHallazgo).where(AuditoriaHallazgo.auditoria_id == a.id))).scalar_one()
    h = AuditoriaHallazgo(auditoria_id=a.id, orden=n + 1, codigo=f"H-{n + 1:02d}", origen="manual", created_by=user.id, **payload.model_dump())
    db.add(h)
    db.add(AuditoriaSeguimiento(auditoria_id=a.id, hallazgo_id=None, tipo="hallazgo", created_by=user.id, texto=f"Hallazgo {h.codigo} agregado: {h.titulo}"))
    a.updated_by, a.updated_at = user.id, datetime.utcnow()
    await db.commit()
    await db.refresh(h)
    await record_action(db, user_id=user.id, action="create_auditoria_hallazgo", resource_type="auditoria", resource_id=a.id,
                        ip=client_ip(request), extra={"hallazgo": h.codigo})
    return h


@router.patch("/informes/{auditoria_id}/hallazgos/{hallazgo_id}", response_model=HallazgoRead)
async def editar_hallazgo(auditoria_id: str, hallazgo_id: str, payload: HallazgoUpdate, request: Request,
                          user: CurrentUser = Depends(require_auditoria), db: AsyncSession = Depends(get_db)) -> AuditoriaHallazgo:
    a = await _get(db, auditoria_id)
    h = await db.get(AuditoriaHallazgo, hallazgo_id)
    if not h or h.auditoria_id != a.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hallazgo no encontrado")
    try:
        payload.validar()
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    cambios = payload.model_dump(exclude_unset=True)
    nota = cambios.pop("nota", None)
    # Con el informe cerrado solo avanza el seguimiento: estado, responsable y fecha compromiso.
    seguimiento = {"estado", "responsable", "fecha_compromiso"}
    if set(cambios) - seguimiento:
        _exigir_editable(a)
    else:
        _exigir_seguimiento(a)
    estado_anterior = h.estado
    for campo, valor in cambios.items():
        setattr(h, campo, valor)
    h.updated_by, h.updated_at = user.id, datetime.utcnow()
    if "estado" in cambios and cambios["estado"] != estado_anterior:
        db.add(AuditoriaSeguimiento(auditoria_id=a.id, hallazgo_id=h.id, tipo="hallazgo", created_by=user.id,
                                    texto=f"{h.codigo} · {h.titulo}: {HALLAZGO_ESTADO_LABEL.get(estado_anterior, estado_anterior)} → {HALLAZGO_ESTADO_LABEL.get(h.estado, h.estado)}." + (f" {nota}" if nota else "")))
    elif nota:
        db.add(AuditoriaSeguimiento(auditoria_id=a.id, hallazgo_id=h.id, tipo="nota", created_by=user.id, texto=f"{h.codigo}: {nota}"))
    a.updated_by, a.updated_at = user.id, datetime.utcnow()
    await db.commit()
    await db.refresh(h)
    await record_action(db, user_id=user.id, action="update_auditoria_hallazgo", resource_type="auditoria", resource_id=a.id,
                        ip=client_ip(request), extra={"hallazgo": h.codigo, "campos": sorted(cambios)})
    return h


@router.delete("/informes/{auditoria_id}/hallazgos/{hallazgo_id}")
async def eliminar_hallazgo(auditoria_id: str, hallazgo_id: str, request: Request,
                            user: CurrentUser = Depends(require_auditoria), db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    a = await _get(db, auditoria_id)
    if a.status != "borrador":
        raise HTTPException(status.HTTP_409_CONFLICT, "Fuera de Borrador un hallazgo no se elimina: marcalo como descartado.")
    h = await db.get(AuditoriaHallazgo, hallazgo_id)
    if not h or h.auditoria_id != a.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hallazgo no encontrado")
    await db.delete(h)
    db.add(AuditoriaSeguimiento(auditoria_id=a.id, tipo="hallazgo", created_by=user.id, texto=f"Hallazgo {h.codigo} eliminado: {h.titulo}"))
    await db.commit()
    await record_action(db, user_id=user.id, action="delete_auditoria_hallazgo", resource_type="auditoria", resource_id=a.id,
                        ip=client_ip(request), extra={"hallazgo": h.codigo})
    return {"status": "deleted"}


# ============================ seguimiento ============================
@router.post("/informes/{auditoria_id}/seguimientos", response_model=SeguimientoRead, status_code=status.HTTP_201_CREATED)
async def agregar_seguimiento(auditoria_id: str, payload: SeguimientoCreate, request: Request,
                              user: CurrentUser = Depends(require_auditoria), db: AsyncSession = Depends(get_db)) -> AuditoriaSeguimiento:
    a = await _get(db, auditoria_id)
    _exigir_seguimiento(a)
    if payload.hallazgo_id:
        h = await db.get(AuditoriaHallazgo, payload.hallazgo_id)
        if not h or h.auditoria_id != a.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Hallazgo no encontrado")
    s = AuditoriaSeguimiento(auditoria_id=a.id, hallazgo_id=payload.hallazgo_id, tipo="nota", texto=payload.texto.strip(), created_by=user.id)
    db.add(s)
    a.updated_by, a.updated_at = user.id, datetime.utcnow()
    await db.commit()
    await db.refresh(s)
    await record_action(db, user_id=user.id, action="create_auditoria_seguimiento", resource_type="auditoria", resource_id=a.id, ip=client_ip(request))
    return s
