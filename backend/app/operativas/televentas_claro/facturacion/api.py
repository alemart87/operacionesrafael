"""Facturación · operativa Televentas CLARO.

Utilidad `televentas_claro.facturacion`: SOLO SUPERADMIN (no asignable a perfiles,
ver core/operativas.py). Flujo: subir .txt de liquidación -> cola (parseo aislado)
-> reporte (borrador) -> publicar -> comparar. Incluye los simuladores de
facturación (móvil y GPON) y el registro de simulaciones.
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime
from typing import Optional

from fastapi import (
    APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ....core.config import settings
from ....core.database import get_db
from .jobs.queue import signal_facturacion_queue
from .models.report import FacturacionReport
from .models.simulacion import FacturacionSimulacion
from .models.upload import FacturacionUpload
from .schemas import (
    CompareRequest, CompareResponse, FacturacionReportDetail, FacturacionReportList,
    FacturacionReportSummary, FacturacionUploadList, FacturacionUploadRead, PublishRequest,
    GponAnualRequest, SimulacionCreate, SimulacionUpdate, SimuladorAnualRequest, SimuladorRequest,
)
from .analyzers.compare import compare_facturacion
from .analyzers.gpon import PARAMETROS_GPON_DEFAULT, simular_gpon, simular_gpon_anual
from .analyzers.simulador import PARAMETROS_DEFAULT, simular_anual, simular_facturacion
from ....services.audit_service import record_action
from ....api.deps import CurrentUser, client_ip, require_perm

PERM = "televentas_claro.facturacion"
require_facturacion_access = require_perm(PERM)
require_facturacion_manage = require_perm(PERM)


router = APIRouter(prefix="/televentas-claro/facturacion", tags=["televentas-claro · facturación"])


def _parse_period(period_month: Optional[str]):
    if not period_month:
        return None
    try:
        return datetime.strptime(period_month, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "period_month debe ser YYYY-MM-DD")


async def _save(file: UploadFile, upload_id: str) -> tuple[str, str, str]:
    if not file.filename:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Archivo sin nombre")
    if not file.filename.lower().endswith(".txt"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Se espera un archivo .txt de liquidación")
    target_dir = settings.upload_path / "facturacion" / upload_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / file.filename

    content = await file.read()
    if len(content) > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"El archivo excede {settings.max_upload_size_mb}MB",
        )
    target.write_bytes(content)
    return file.filename, str(target.resolve()), hashlib.sha256(content).hexdigest()


# ============================ UPLOADS ============================
@router.post("/uploads", response_model=FacturacionUploadRead, status_code=status.HTTP_202_ACCEPTED)
async def create_upload(
    request: Request,
    file: UploadFile = File(..., description="Liquidación .txt (Televentas Claro)"),
    period_month: Optional[str] = Form(None),
    user: CurrentUser = Depends(require_facturacion_manage),
    db: AsyncSession = Depends(get_db),
) -> FacturacionUpload:
    period_date = _parse_period(period_month)
    # Validar ANTES de crear la fila: si no, queda un upload 'pending' sin archivo en la cola.
    if not file.filename or not file.filename.lower().endswith(".txt"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Se espera un archivo .txt de liquidación")
    upload = FacturacionUpload(uploaded_by=user.id, status="pending", period_month=period_date)
    db.add(upload)
    await db.commit()
    await db.refresh(upload)

    upload.filename, upload.file_path, upload.file_sha256 = await _save(file, upload.id)
    await db.commit()

    await record_action(
        db, user_id=user.id, action="create_facturacion_upload",
        resource_type="facturacion_upload", resource_id=upload.id,
        ip=client_ip(request), extra={"period_month": period_month, "filename": upload.filename},
    )
    signal_facturacion_queue()
    return upload


@router.get("/uploads", response_model=FacturacionUploadList)
async def list_uploads(
    user: CurrentUser = Depends(require_facturacion_access),
    db: AsyncSession = Depends(get_db),
) -> FacturacionUploadList:
    rows = await db.execute(
        select(FacturacionUpload).order_by(FacturacionUpload.uploaded_at.desc()).limit(100))
    items = rows.scalars().all()
    return FacturacionUploadList(
        items=[FacturacionUploadRead.model_validate(u) for u in items], total=len(items))


@router.get("/uploads/{upload_id}", response_model=FacturacionUploadRead)
async def get_upload(
    upload_id: str,
    user: CurrentUser = Depends(require_facturacion_access),
    db: AsyncSession = Depends(get_db),
) -> FacturacionUpload:
    upload = await db.get(FacturacionUpload, upload_id)
    if not upload:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Upload no encontrado")
    return upload


# ============================ REPORTS ============================
@router.get("/reports", response_model=FacturacionReportList)
async def list_reports(
    user: CurrentUser = Depends(require_facturacion_access),
    db: AsyncSession = Depends(get_db),
) -> FacturacionReportList:
    rows = await db.execute(
        select(FacturacionReport).order_by(FacturacionReport.generated_at.desc()).limit(200))
    items = rows.scalars().all()
    return FacturacionReportList(
        items=[FacturacionReportSummary.model_validate(r) for r in items], total=len(items))


@router.get("/reports/{report_id}", response_model=FacturacionReportDetail)
async def get_report(
    report_id: str,
    request: Request,
    user: CurrentUser = Depends(require_facturacion_access),
    db: AsyncSession = Depends(get_db),
) -> FacturacionReport:
    report = await db.get(FacturacionReport, report_id)
    if not report:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reporte no encontrado")
    await record_action(
        db, user_id=user.id, action="view_facturacion_report",
        resource_type="facturacion_report", resource_id=report_id,
        ip=client_ip(request), extra={"role": user.role},
    )
    return report


@router.post("/reports/{report_id}/publish", response_model=FacturacionReportSummary)
async def publish_report(
    report_id: str,
    payload: PublishRequest,
    request: Request,
    user: CurrentUser = Depends(require_facturacion_manage),
    db: AsyncSession = Depends(get_db),
) -> FacturacionReport:
    report = await db.get(FacturacionReport, report_id)
    if not report:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reporte no encontrado")
    report.is_published = payload.is_published
    if payload.is_published:
        report.published_at = datetime.utcnow()
        report.published_by = user.id
    else:
        report.published_at = None
        report.published_by = None
    if payload.title is not None:
        report.title = payload.title
    await db.commit()
    await db.refresh(report)
    await record_action(
        db, user_id=user.id,
        action="publish_facturacion_report" if payload.is_published else "unpublish_facturacion_report",
        resource_type="facturacion_report", resource_id=report_id, ip=client_ip(request),
    )
    return report


@router.delete("/reports/{report_id}")
async def delete_report(
    report_id: str,
    request: Request,
    user: CurrentUser = Depends(require_facturacion_manage),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    report = await db.get(FacturacionReport, report_id)
    if not report:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reporte no encontrado")
    await db.delete(report)
    await db.commit()
    await record_action(
        db, user_id=user.id, action="delete_facturacion_report",
        resource_type="facturacion_report", resource_id=report_id, ip=client_ip(request),
    )
    return {"status": "deleted", "report_id": report_id}


# ============================ SIMULADOR DE FACTURACIÓN ============================
@router.get("/simulador/parametros")
async def simulador_parametros(user: CurrentUser = Depends(require_facturacion_access)) -> dict:
    """Variables de negocio y componentes de facturación (todas editables), sembradas
    con las liquidaciones reales y los criterios de Claro (bonos, cuota 2, zafra)."""
    return {"parametros": PARAMETROS_DEFAULT}


# ---- Negocio GPON (fibra + TV): motor propio, calibrado con las liquidaciones GPON 385–389 ----
@router.get("/gpon/parametros")
async def gpon_parametros(user: CurrentUser = Depends(require_facturacion_access)) -> dict:
    """Variables del negocio GPON (planes, cuota 2, bono fijo, mora, recálculo, costos)."""
    return {"parametros": PARAMETROS_GPON_DEFAULT}


@router.post("/gpon/simulador")
async def gpon_simulador_run(payload: SimuladorRequest, user: CurrentUser = Depends(require_facturacion_access)) -> dict:
    """UNA cohorte GPON: facturación del mes, cuota 2, legajos, mora, recálculo y margen a 6/12 meses."""
    try:
        return simular_gpon(payload.parametros)
    except (TypeError, ValueError, KeyError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Parámetros inválidos: {exc}")


@router.post("/gpon/anual")
async def gpon_anual_run(payload: GponAnualRequest, user: CurrentUser = Depends(require_facturacion_access)) -> dict:
    """Proyección anual GPON (12, 18 o 24 meses), multicohorte, con cola posterior."""
    if payload.horizonte not in (12, 18, 24):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El horizonte debe ser 12, 18 o 24 meses.")
    try:
        return simular_gpon_anual(payload.parametros, payload.ventas_por_mes, payload.horizonte,
                                  payload.bonos_adicionales_por_mes, payload.nombres_meses, payload.meses_afectados)
    except (TypeError, ValueError, KeyError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Parámetros inválidos: {exc}")


@router.post("/simulador")
async def simulador_run(payload: SimuladorRequest,
                        user: CurrentUser = Depends(require_facturacion_access)) -> dict:
    """Con la cantidad de ventas (y cualquier variable sobreescrita) genera la
    facturación del mes, la proyección a 12 meses con caídas por chargeback
    (zafra) y el peso de los bonos sobre la facturación neta."""
    try:
        return simular_facturacion(payload.parametros)
    except (TypeError, ValueError, KeyError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Parámetros inválidos: {exc}")


@router.post("/simulador/anual")
async def simulador_anual_run(payload: SimuladorAnualRequest,
                              user: CurrentUser = Depends(require_facturacion_access)) -> dict:
    """Simulación ANUAL (independiente): el mes 1 fija estructura y objetivo; los
    meses 2..12 solo cambian las ventas. Balance mensual con los ajustes de todas
    las cohortes, EERR anual y cola pendiente después del mes 12."""
    try:
        if payload.horizonte not in (12, 18):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "El horizonte debe ser 12 o 18 meses.")
        return simular_anual(payload.parametros, payload.ventas_por_mes, payload.horizonte, payload.meses_afectados,
                             payload.bonos_adicionales_por_mes, payload.nombres_meses)
    except (TypeError, ValueError, KeyError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Parámetros inválidos: {exc}")


# ============================ SIMULACIONES GUARDADAS (registro del trabajo) ============================
def _postits_con_autor(postits: list[dict], user: CurrentUser) -> list[dict]:
    """Los post-its nuevos (sin id/autor/fecha) quedan firmados por quien los carga."""
    out: list[dict] = []
    for pi in postits or []:
        if not isinstance(pi, dict) or not str(pi.get("texto") or "").strip():
            continue
        out.append({
            "id": pi.get("id") or str(uuid.uuid4()),
            "texto": str(pi["texto"]).strip()[:2000],
            "color": pi.get("color") or "amarillo",
            "item": pi.get("item") or None,                 # key de una marca (opcional)
            "autor": pi.get("autor") or user.full_name,
            "fecha": pi.get("fecha") or datetime.utcnow().isoformat(),
            # Posición en el lienzo de trabajo (px desde el borde superior izquierdo).
            "x": float(pi.get("x") or 0), "y": float(pi.get("y") or 0),
        })
    return out


_TIPOS_NOTA = ("supuesto", "observacion", "decision", "pendiente", "riesgo")


def _notas_con_autor(notas: list[dict], user: CurrentUser) -> list[dict]:
    """Notas y comentarios sobre la simulación: las nuevas quedan firmadas; las editadas
    conservan autor y fecha originales y registran quién y cuándo editó."""
    out: list[dict] = []
    for n in notas or []:
        if not isinstance(n, dict) or not str(n.get("texto") or "").strip():
            continue
        out.append({
            "id": n.get("id") or str(uuid.uuid4()),
            "texto": str(n["texto"]).strip()[:4000],
            "tipo": n.get("tipo") if n.get("tipo") in _TIPOS_NOTA else "observacion",
            "mes": int(n["mes"]) if str(n.get("mes") or "").strip().isdigit() else None,
            "autor": n.get("autor") or user.full_name,
            "fecha": n.get("fecha") or datetime.utcnow().isoformat(),
            "editada_por": n.get("editada_por") or None,
            "editada_el": n.get("editada_el") or None,
        })
    return out


def _marcas_limpias(marcas: list[dict]) -> list[dict]:
    vistos: set[str] = set()
    out: list[dict] = []
    for m in marcas or []:
        if not isinstance(m, dict) or not m.get("key") or m["key"] in vistos:
            continue
        vistos.add(m["key"])
        out.append({"key": str(m["key"])[:80], "label": str(m.get("label") or m["key"])[:160]})
    return out


def _simulacion_out(s: FacturacionSimulacion, detalle: bool = True) -> dict:
    base = {
        "id": s.id, "nombre": s.nombre, "comentario": s.comentario, "horizonte": s.horizonte,
        "resumen": s.resumen or {}, "marcas": s.marcas or [], "postits": s.postits or [], "notas": s.notas or [],
        "created_by": s.created_by, "created_by_nombre": s.created_by_nombre,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_by_nombre": s.updated_by_nombre,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
        # negocio de la simulación: "GPON" o "MOVIL" (pospago); las viejas sin marca son móvil
        "negocio": "GPON" if (s.parametros or {}).get("negocio") == "GPON" else "MOVIL",
    }
    if detalle:
        base["parametros"] = s.parametros or {}
        base["ventas_por_mes"] = s.ventas_por_mes or []
        base["meses_afectados"] = s.meses_afectados or {}
        base["bonos_adicionales_por_mes"] = s.bonos_adicionales_por_mes or []
        base["nombres_meses"] = s.nombres_meses or []
    return base


@router.get("/simulaciones")
async def listar_simulaciones(user: CurrentUser = Depends(require_facturacion_access),
                              db: AsyncSession = Depends(get_db)) -> dict:
    rows = (await db.execute(
        select(FacturacionSimulacion).order_by(FacturacionSimulacion.created_at.desc()).limit(200)
    )).scalars().all()
    return {"simulaciones": [_simulacion_out(s, detalle=False) for s in rows]}


@router.post("/simulaciones", status_code=status.HTTP_201_CREATED)
async def crear_simulacion(payload: SimulacionCreate, request: Request,
                           user: CurrentUser = Depends(require_facturacion_access),
                           db: AsyncSession = Depends(get_db)) -> dict:
    if payload.horizonte not in (12, 18):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El horizonte debe ser 12 o 18 meses.")
    s = FacturacionSimulacion(
        nombre=payload.nombre.strip(), comentario=(payload.comentario or "").strip() or None,
        horizonte=payload.horizonte, parametros=payload.parametros, ventas_por_mes=payload.ventas_por_mes,
        meses_afectados=payload.meses_afectados or {},
        bonos_adicionales_por_mes=payload.bonos_adicionales_por_mes or [], nombres_meses=payload.nombres_meses or [],
        marcas=_marcas_limpias(payload.marcas), postits=_postits_con_autor(payload.postits, user),
        notas=_notas_con_autor(payload.notas, user),
        resumen=payload.resumen, created_by=user.id, created_by_nombre=user.full_name,
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    await record_action(db, user_id=user.id, action="create_facturacion_simulacion",
                        resource_type="facturacion_simulacion", resource_id=s.id,
                        ip=client_ip(request), extra={"nombre": s.nombre, "horizonte": s.horizonte})
    return _simulacion_out(s)


@router.get("/simulaciones/{simulacion_id}")
async def obtener_simulacion(simulacion_id: str, user: CurrentUser = Depends(require_facturacion_access),
                             db: AsyncSession = Depends(get_db)) -> dict:
    s = await db.get(FacturacionSimulacion, simulacion_id)
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Simulación no encontrada")
    return _simulacion_out(s)


@router.patch("/simulaciones/{simulacion_id}")
async def actualizar_simulacion(simulacion_id: str, payload: SimulacionUpdate, request: Request,
                                user: CurrentUser = Depends(require_facturacion_access),
                                db: AsyncSession = Depends(get_db)) -> dict:
    s = await db.get(FacturacionSimulacion, simulacion_id)
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Simulación no encontrada")
    if payload.nombre is not None:
        if not payload.nombre.strip():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "La simulación necesita un nombre.")
        s.nombre = payload.nombre.strip()
    if payload.comentario is not None:
        s.comentario = payload.comentario.strip() or None
    if payload.horizonte is not None:
        if payload.horizonte not in (12, 18):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "El horizonte debe ser 12 o 18 meses.")
        s.horizonte = payload.horizonte
    if payload.parametros is not None:
        s.parametros = payload.parametros
    if payload.ventas_por_mes is not None:
        if not payload.ventas_por_mes:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Faltan las ventas por mes.")
        s.ventas_por_mes = payload.ventas_por_mes
    if payload.meses_afectados is not None:
        s.meses_afectados = payload.meses_afectados
    if payload.bonos_adicionales_por_mes is not None:
        s.bonos_adicionales_por_mes = payload.bonos_adicionales_por_mes
    if payload.nombres_meses is not None:
        s.nombres_meses = [str(x or "")[:40] for x in payload.nombres_meses]
    if payload.marcas is not None:
        s.marcas = _marcas_limpias(payload.marcas)
    if payload.postits is not None:
        s.postits = _postits_con_autor(payload.postits, user)
    if payload.notas is not None:
        previas = {n.get("id"): n for n in (s.notas or [])}
        nuevas = _notas_con_autor(payload.notas, user)
        for n in nuevas:   # edición: si el texto cambió respecto de la guardada, queda quién y cuándo
            prev = previas.get(n["id"])
            if prev and prev.get("texto") != n["texto"]:
                n["editada_por"], n["editada_el"] = user.full_name, datetime.utcnow().isoformat()
        s.notas = nuevas
    if payload.resumen is not None:
        s.resumen = payload.resumen
    s.updated_by_nombre = user.full_name
    await db.commit()
    await db.refresh(s)
    await record_action(db, user_id=user.id, action="update_facturacion_simulacion",
                        resource_type="facturacion_simulacion", resource_id=s.id,
                        ip=client_ip(request),
                        extra={"campos": [k for k, v in payload.model_dump().items() if v is not None]})
    return _simulacion_out(s)


@router.delete("/simulaciones/{simulacion_id}")
async def borrar_simulacion(simulacion_id: str, request: Request,
                            user: CurrentUser = Depends(require_facturacion_access),
                            db: AsyncSession = Depends(get_db)) -> dict:
    s = await db.get(FacturacionSimulacion, simulacion_id)
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Simulación no encontrada")
    await db.delete(s)
    await db.commit()
    await record_action(db, user_id=user.id, action="delete_facturacion_simulacion",
                        resource_type="facturacion_simulacion", resource_id=simulacion_id,
                        ip=client_ip(request), extra={"nombre": s.nombre})
    return {"status": "deleted", "id": simulacion_id}


# ============================ COMPARE ============================
@router.post("/compare", response_model=CompareResponse)
async def compare_reports(
    payload: CompareRequest,
    request: Request,
    user: CurrentUser = Depends(require_facturacion_access),
    db: AsyncSession = Depends(get_db),
) -> CompareResponse:
    rows = await db.execute(
        select(FacturacionReport).where(FacturacionReport.id.in_(payload.report_ids)))
    reports = rows.scalars().all()
    if len(reports) < 2:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Se requieren al menos 2 reportes válidos")

    payload_data = [
        {
            "id": r.id,
            "title": r.title,
            "periodo": r.periodo,
            "nro_liquidacion": r.nro_liquidacion,
            "generated_at": r.generated_at.isoformat() if r.generated_at else "",
            "data": r.data or {},
        }
        for r in reports
    ]
    result = compare_facturacion(payload_data)
    await record_action(
        db, user_id=user.id, action="compare_facturacion_reports",
        resource_type="facturacion_report", resource_id=payload.report_ids[0][:100],
        ip=client_ip(request),
        extra={"count": len(reports), "report_ids": list(payload.report_ids)},
    )
    return CompareResponse(**result)
