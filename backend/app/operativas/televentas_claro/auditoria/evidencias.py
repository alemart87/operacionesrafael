"""Evidencia visual de los informes de auditoría: figuras numeradas con piezas del lienzo de Voi e imágenes.

- **Imágenes** (capturas, fotos): se procesan en un subproceso aislado (`app.services.imagenes`): se valida que sean
  imágenes reales, se enderezan, pierden todos sus metadatos (EXIF: ubicación, dispositivo) y se guardan en WebP
  (completa y miniatura) en el disco persistente, en `UPLOAD_DIR/auditoria/<informe>/`. Las rutas las arma el
  servidor (nunca vienen del usuario) y solo las sirve con el permiso de Auditoría.
- **Piezas del lienzo**: se congela su especificación (ya validada): el gráfico se vuelve a dibujar igual en la
  pantalla y en el PDF. Las suma Voi (con la elección del usuario) o el usuario desde el lienzo (`app.asistente`).
- Se agregan, editan, ordenan y quitan mientras el informe está en Borrador o En revisión; se ven siempre.
"""
from __future__ import annotations

import asyncio
import hashlib
import re
import shutil
from datetime import datetime
from pathlib import Path, PurePath
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import CurrentUser, client_ip, require_perm
from ....core.config import settings
from ....core.database import get_db
from ....core.logging import logger
from ....jobs.isolated import friendly_error, run_isolated
from ....services import imagenes
from ....services.audit_service import record_action
from .models import (
    ESTADOS_EDITABLES, MAX_EVIDENCIAS, Auditoria, AuditoriaEvidencia, AuditoriaHallazgo, AuditoriaSeguimiento, gen_uuid,
)
from .schemas import EvidenciaRead, EvidenciasOrden, EvidenciaUpdate

PERM = "televentas_claro.auditoria"
require_auditoria = require_perm(PERM)
router = APIRouter(prefix="/televentas-claro/auditoria", tags=["televentas-claro · auditoría"])

MAX_IMAGEN_MB = 15


class EvidenciaError(ValueError):
    """Lo que no se puede hacer con la evidencia, explicado para el usuario (409 o 400 en la API)."""

    def __init__(self, mensaje: str, codigo: int = status.HTTP_409_CONFLICT):
        super().__init__(mensaje)
        self.codigo = codigo


# ------------------------------------------------------------------ archivos en el disco persistente
def carpeta(auditoria_id: str) -> Path:
    return settings.upload_path / "auditoria" / auditoria_id


def ruta(relativa: Optional[str]) -> Optional[Path]:
    """La ruta absoluta de un archivo guardado, solo si queda dentro de UPLOAD_DIR."""
    if not relativa:
        return None
    base = settings.upload_path.resolve()
    p = (base / relativa).resolve()
    return p if p.is_relative_to(base) else None


def _escribir(destino: Path, datos: bytes) -> None:
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_suffix(destino.suffix + ".tmp")
    tmp.write_bytes(datos)
    tmp.replace(destino)                         # atómico: nunca queda un archivo a medias


def _borrar_archivos(*relativas: Optional[str]) -> None:
    for rel in relativas:
        p = ruta(rel)
        if p is not None:
            try:
                p.unlink(missing_ok=True)
            except OSError as exc:  # pragma: no cover - permisos del disco
                logger.warning(f"Auditoría: no se pudo borrar {p}: {exc}")


# ------------------------------------------------------------------ servicio (también lo usa Voi)
def evidencia_read(e: AuditoriaEvidencia) -> EvidenciaRead:
    disponible = True
    if e.tipo == "imagen":
        p = ruta(e.archivo)
        disponible = bool(p and p.exists())
    return EvidenciaRead.model_validate(e).model_copy(update={"disponible": disponible})


async def listar(db: AsyncSession, auditoria_id: str) -> list[AuditoriaEvidencia]:
    return list((await db.execute(select(AuditoriaEvidencia).where(AuditoriaEvidencia.auditoria_id == auditoria_id)
                                  .order_by(AuditoriaEvidencia.orden, AuditoriaEvidencia.created_at))).scalars().all())


def exigir_editable(a: Auditoria) -> None:
    if a.status not in ESTADOS_EDITABLES:
        raise EvidenciaError(f"El informe {a.codigo} está {a.status.replace('_', ' ')}: su evidencia quedó fija. "
                             "Reabrilo para sumar o cambiar figuras.")


async def _hallazgo_valido(db: AsyncSession, a: Auditoria, hallazgo_id: Optional[str]) -> Optional[str]:
    if not hallazgo_id:
        return None
    h = await db.get(AuditoriaHallazgo, hallazgo_id)
    if h is None or h.auditoria_id != a.id:
        raise EvidenciaError("Ese hallazgo no es de este informe.", status.HTTP_400_BAD_REQUEST)
    return h.id


async def _lugar(db: AsyncSession, a: Auditoria, cuantas: int = 1) -> int:
    fila = (await db.execute(select(func.count(), func.max(AuditoriaEvidencia.orden))
                             .where(AuditoriaEvidencia.auditoria_id == a.id))).one()
    total, ultimo = fila
    if (total or 0) + cuantas > MAX_EVIDENCIAS:
        raise EvidenciaError(f"Un informe admite hasta {MAX_EVIDENCIAS} figuras: quitá alguna antes de sumar más.")
    return (ultimo + 1) if ultimo is not None else 0


def _bitacora(db: AsyncSession, a: Auditoria, user_id: str, texto: str) -> None:
    db.add(AuditoriaSeguimiento(auditoria_id=a.id, tipo="evidencia", created_by=user_id, texto=texto[:4000]))
    a.updated_by, a.updated_at = user_id, datetime.utcnow()


async def crear_grafico(db: AsyncSession, a: Auditoria, spec: dict[str, Any], *, user_id: str, titulo: Optional[str] = None,
                        nota: Optional[str] = None, hallazgo_id: Optional[str] = None, origen: str = "lienzo",
                        conversacion_id: Optional[str] = None, artefacto_id: Optional[str] = None,
                        ) -> tuple[AuditoriaEvidencia, bool]:
    """Suma una pieza del lienzo (ya validada) como figura. Devuelve (evidencia, nueva): si esa misma pieza ya estaba en
    el informe, no se duplica. No hace commit."""
    exigir_editable(a)
    if artefacto_id:
        previa = (await db.execute(select(AuditoriaEvidencia).where(
            AuditoriaEvidencia.auditoria_id == a.id, AuditoriaEvidencia.artefacto_id == artefacto_id))).scalars().first()
        if previa is not None:
            return previa, False
    e = AuditoriaEvidencia(
        auditoria_id=a.id, orden=await _lugar(db, a), tipo="grafico",
        titulo=(titulo or spec.get("titulo") or "Figura")[:255].strip() or "Figura",
        nota=(nota or "").strip()[:4000] or None, hallazgo_id=await _hallazgo_valido(db, a, hallazgo_id), spec=spec,
        origen=origen if origen in ("voi", "lienzo") else "lienzo", conversacion_id=conversacion_id,
        artefacto_id=artefacto_id, created_by=user_id)
    db.add(e)
    _bitacora(db, a, user_id, f"Figura sumada{' por Voi' if origen == 'voi' else ' desde el lienzo'}: {e.titulo}")
    return e, True


async def borrar_todas(db: AsyncSession, auditoria_id: str) -> None:
    """Al eliminar un borrador: sus figuras y la carpeta de imágenes en el disco. No hace commit."""
    for e in await listar(db, auditoria_id):
        await db.delete(e)
    p = carpeta(auditoria_id)
    if p.exists():
        await asyncio.to_thread(shutil.rmtree, p, True)


# ------------------------------------------------------------------ API
async def _informe(db: AsyncSession, auditoria_id: str) -> Auditoria:
    a = await db.get(Auditoria, auditoria_id)
    if not a:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Informe de auditoría no encontrado")
    return a


async def _evidencia(db: AsyncSession, a: Auditoria, evidencia_id: str) -> AuditoriaEvidencia:
    e = await db.get(AuditoriaEvidencia, evidencia_id)
    if e is None or e.auditoria_id != a.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Figura no encontrada")
    return e


def _http(exc: EvidenciaError) -> HTTPException:
    return HTTPException(exc.codigo, str(exc))


def _nombre_seguro(nombre: Optional[str]) -> str:
    base = PurePath((nombre or "").replace("\\", "/")).name
    return re.sub(r"[\x00-\x1f\x7f\"<>:|?*]", "", base).strip(" .")[:200] or "imagen"


@router.get("/informes/{auditoria_id}/evidencias", response_model=list[EvidenciaRead])
async def ver_evidencias(auditoria_id: str, user: CurrentUser = Depends(require_auditoria),
                         db: AsyncSession = Depends(get_db)) -> list[EvidenciaRead]:
    a = await _informe(db, auditoria_id)
    return [evidencia_read(e) for e in await listar(db, a.id)]


@router.get("/informes/{auditoria_id}/evidencias/indice")
async def indice_evidencias(auditoria_id: str, user: CurrentUser = Depends(require_auditoria),
                            db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Lo mínimo para sumar evidencia desde Voi: el informe, sus hallazgos y sus figuras (sin la evidencia congelada,
    que puede ser grande). El lienzo lo usa para marcar qué piezas ya están en el informe y con qué número."""
    a = await _informe(db, auditoria_id)
    hallazgos = (await db.execute(select(AuditoriaHallazgo).where(AuditoriaHallazgo.auditoria_id == a.id)
                                  .order_by(AuditoriaHallazgo.orden))).scalars().all()
    return {
        "informe": {"id": a.id, "codigo": a.codigo, "titulo": a.titulo, "status": a.status,
                    "editable": a.status in ESTADOS_EDITABLES},
        "hallazgos": [{"id": h.id, "codigo": h.codigo, "titulo": h.titulo, "severidad": h.severidad, "estado": h.estado}
                      for h in hallazgos],
        "figuras": [{"id": e.id, "figura": i + 1, "titulo": e.titulo, "tipo": e.tipo, "origen": e.origen,
                     "artefacto_id": e.artefacto_id, "hallazgo_id": e.hallazgo_id}
                    for i, e in enumerate(await listar(db, a.id))],
    }


@router.post("/informes/{auditoria_id}/evidencias/imagen", response_model=EvidenciaRead, status_code=status.HTTP_201_CREATED)
async def subir_imagen(auditoria_id: str, request: Request, archivo: UploadFile = File(...), titulo: str = Form(""),
                       nota: str = Form(""), hallazgo_id: str = Form(""), user: CurrentUser = Depends(require_auditoria),
                       db: AsyncSession = Depends(get_db)) -> EvidenciaRead:
    """Sube una imagen (PNG, JPG, WebP o GIF) como figura del informe: queda en el disco persistente, sin metadatos."""
    a = await _informe(db, auditoria_id)
    try:
        exigir_editable(a)
        hallazgo = await _hallazgo_valido(db, a, hallazgo_id.strip() or None)
        orden = await _lugar(db, a)
    except EvidenciaError as exc:
        raise _http(exc) from exc
    limite = min(settings.max_upload_size_mb, MAX_IMAGEN_MB) * 1024 * 1024
    contenido = await archivo.read(limite + 1)
    if not contenido:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El archivo está vacío.")
    if len(contenido) > limite:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"La imagen supera {limite // (1024 * 1024)} MB.")
    nombre = _nombre_seguro(archivo.filename)
    try:
        r = await run_isolated(imagenes.procesar, contenido)
    except imagenes.ImagenInvalida as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — tiempo, memoria o un archivo que rompe el decodificador
        logger.warning(f"Auditoría: no se pudo procesar la imagen {nombre}: {exc!r}")
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, friendly_error(exc)) from exc

    eid = gen_uuid()
    rel, rel_m = f"auditoria/{a.id}/{eid}.webp", f"auditoria/{a.id}/{eid}-m.webp"
    destino, destino_m = ruta(rel), ruta(rel_m)
    if destino is None or destino_m is None:      # pragma: no cover - UPLOAD_DIR mal configurado
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Almacenamiento no disponible")
    try:
        await asyncio.to_thread(_escribir, destino, r["completa"])
        await asyncio.to_thread(_escribir, destino_m, r["miniatura"])
    except OSError as exc:
        _borrar_archivos(rel, rel_m)
        logger.error(f"Auditoría: no se pudo guardar la imagen en {destino}: {exc}")
        raise HTTPException(status.HTTP_507_INSUFFICIENT_STORAGE, "No se pudo guardar la imagen en el disco. Avisá a soporte.") from exc
    e = AuditoriaEvidencia(
        id=eid, auditoria_id=a.id, orden=orden, tipo="imagen",
        titulo=(titulo.strip() or PurePath(nombre).stem.replace("_", " ").strip() or "Imagen")[:255],
        nota=nota.strip()[:4000] or None, hallazgo_id=hallazgo, archivo=rel, miniatura=rel_m, archivo_nombre=nombre,
        bytes=len(r["completa"]), ancho=r["ancho"], alto=r["alto"], sha256=hashlib.sha256(contenido).hexdigest(),
        origen="subida", created_by=user.id)
    db.add(e)
    _bitacora(db, a, user.id, f"Imagen sumada como figura: {e.titulo}")
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        _borrar_archivos(rel, rel_m)
        raise
    await db.refresh(e)
    await record_action(db, user_id=user.id, action="create_auditoria_evidencia", resource_type="auditoria", resource_id=a.id,
                        ip=client_ip(request), extra={"evidencia": e.id, "tipo": "imagen", "archivo": nombre,
                                                     "bytes": len(contenido), "sha256": e.sha256})
    return evidencia_read(e)


@router.get("/informes/{auditoria_id}/evidencias/{evidencia_id}/imagen")
async def ver_imagen(auditoria_id: str, evidencia_id: str, v: Literal["completa", "miniatura"] = Query("completa"),
                     user: CurrentUser = Depends(require_auditoria), db: AsyncSession = Depends(get_db)) -> FileResponse:
    a = await _informe(db, auditoria_id)
    e = await _evidencia(db, a, evidencia_id)
    p = ruta(e.miniatura if v == "miniatura" else e.archivo) if e.tipo == "imagen" else None
    if p is None or not p.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "La imagen no está en el disco")
    return FileResponse(p, media_type="image/webp", headers={
        "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff",
        "Content-Disposition": f'inline; filename="figura-{e.id[:8]}.webp"'})


@router.patch("/informes/{auditoria_id}/evidencias/{evidencia_id}", response_model=EvidenciaRead)
async def editar_evidencia(auditoria_id: str, evidencia_id: str, payload: EvidenciaUpdate, request: Request,
                           user: CurrentUser = Depends(require_auditoria), db: AsyncSession = Depends(get_db)) -> EvidenciaRead:
    a = await _informe(db, auditoria_id)
    e = await _evidencia(db, a, evidencia_id)
    cambios = payload.model_dump(exclude_unset=True)
    try:
        exigir_editable(a)
        if "hallazgo_id" in cambios:
            e.hallazgo_id = await _hallazgo_valido(db, a, (cambios["hallazgo_id"] or "").strip() or None)
    except EvidenciaError as exc:
        raise _http(exc) from exc
    if cambios.get("titulo"):
        e.titulo = cambios["titulo"].strip()[:255] or e.titulo
    if "nota" in cambios:
        e.nota = (cambios["nota"] or "").strip()[:4000] or None
    e.updated_by, e.updated_at = user.id, datetime.utcnow()
    a.updated_by, a.updated_at = user.id, datetime.utcnow()
    await db.commit()
    await db.refresh(e)
    await record_action(db, user_id=user.id, action="update_auditoria_evidencia", resource_type="auditoria", resource_id=a.id,
                        ip=client_ip(request), extra={"evidencia": e.id, "campos": sorted(cambios)})
    return evidencia_read(e)


@router.post("/informes/{auditoria_id}/evidencias/orden", response_model=list[EvidenciaRead])
async def ordenar_evidencias(auditoria_id: str, payload: EvidenciasOrden, user: CurrentUser = Depends(require_auditoria),
                             db: AsyncSession = Depends(get_db)) -> list[EvidenciaRead]:
    a = await _informe(db, auditoria_id)
    try:
        exigir_editable(a)
    except EvidenciaError as exc:
        raise _http(exc) from exc
    actuales = {e.id: e for e in await listar(db, a.id)}
    if len(payload.ids) != len(set(payload.ids)) or set(payload.ids) != set(actuales):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El orden tiene que incluir todas las figuras del informe, una vez.")
    for i, eid in enumerate(payload.ids):
        actuales[eid].orden = i
    a.updated_by, a.updated_at = user.id, datetime.utcnow()
    await db.commit()
    return [evidencia_read(e) for e in await listar(db, a.id)]


@router.delete("/informes/{auditoria_id}/evidencias/{evidencia_id}")
async def quitar_evidencia(auditoria_id: str, evidencia_id: str, request: Request,
                           user: CurrentUser = Depends(require_auditoria), db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    a = await _informe(db, auditoria_id)
    e = await _evidencia(db, a, evidencia_id)
    try:
        exigir_editable(a)
    except EvidenciaError as exc:
        raise _http(exc) from exc
    archivos = (e.archivo, e.miniatura)
    titulo = e.titulo
    await db.delete(e)
    _bitacora(db, a, user.id, f"Figura quitada: {titulo}")
    await db.commit()
    _borrar_archivos(*archivos)
    await record_action(db, user_id=user.id, action="delete_auditoria_evidencia", resource_type="auditoria", resource_id=a.id,
                        ip=client_ip(request), extra={"evidencia": evidencia_id, "titulo": titulo})
    return {"status": "deleted"}
