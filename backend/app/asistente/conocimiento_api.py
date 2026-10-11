"""API de la base de conocimiento de Voi.

- Superadmin (`/asistente/admin/documentos`): subir (PDF, Word, texto), ver el texto extraído, cambiar título,
  descripción, alcance o estado, reemplazar el archivo, borrar y probar la búsqueda. Todo queda en la auditoría.
- Quien usa Voi (`/asistente/citas/{id}` y `/asistente/documentos/{id}/archivo`): ver el pasaje de una cita y
  descargar el documento, solo si su alcance lo incluye (si no, responde como si no existiera).
"""
from __future__ import annotations

import gzip
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import PurePath
from typing import Any, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from ..api.deps import CurrentUser, client_ip, require_superadmin
from ..core.config import settings
from ..core.database import get_db
from ..core.operativas import OPERATIVAS
from ..jobs.isolated import friendly_error, run_isolated
from ..models.user import User
from ..services import extraccion_texto
from ..services.audit_service import record_action
from . import conocimiento
from .api import usuario_voi
from .models import AsistenteDocumento, AsistenteFragmento

log = logging.getLogger("asistente.conocimiento")
router = APIRouter(prefix="/asistente", tags=["asistente"])
admin_router = APIRouter(prefix="/asistente/admin/documentos", tags=["asistente-admin"])

TIPOS = {".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
         ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}


def _nombre_seguro(nombre: Optional[str]) -> str:
    base = PurePath((nombre or "").replace("\\", "/")).name
    base = re.sub(r"[\x00-\x1f\x7f\"<>:|?*]", "", base).strip(" .")
    return base[:200] or "documento"


def _validar_archivo(nombre: str, contenido: bytes) -> str:
    extension = PurePath(nombre).suffix.lower()
    if extension not in TIPOS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Formato no admitido: subí un PDF, un Word (.docx), un .txt o un .md.")
    if not contenido:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El archivo está vacío.")
    if len(contenido) > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"El archivo excede {settings.max_upload_size_mb} MB.")
    # La extensión tiene que coincidir con el contenido (firma del archivo).
    if extension == ".pdf" and b"%PDF-" not in contenido[:1024]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El archivo no es un PDF válido.")
    if extension == ".docx" and not contenido.startswith(b"PK\x03\x04"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El archivo no es un Word (.docx) válido. Si es un .doc viejo, "
                                                         "guardalo como .docx o PDF.")
    return extension


async def _extraer(nombre: str, contenido: bytes) -> dict[str, Any]:
    try:
        r = await run_isolated(extraccion_texto.procesar, nombre, contenido)
    except extraccion_texto.DocumentoInvalido as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — timeout, memoria, archivo que rompe el lector
        log.warning("No se pudo extraer el texto de %s: %r", nombre, exc)
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, friendly_error(exc)) from exc
    if not r["fragmentos"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "No encontré texto en el archivo. Si es un PDF escaneado (una imagen), Voi no lo puede leer: "
                            "subí la versión con texto seleccionable o un Word.")
    return r


def _alcance(texto: Optional[str]) -> dict[str, Any]:
    try:
        valor = json.loads(texto) if texto else {"tipo": "todos"}
    except json.JSONDecodeError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Alcance inválido") from exc
    try:
        return conocimiento.alcance_valido(valor)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


async def _nombres(db: AsyncSession, ids: set[Optional[str]]) -> dict[str, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    filas = (await db.execute(select(User.id, User.full_name).where(User.id.in_(ids)))).all()
    out = {uid: nombre for uid, nombre in filas}
    return {i: out.get(i, settings.superadmin_name if i == "superadmin" else i) for i in ids}


def _dict(d: AsistenteDocumento, nombres: dict[str, str] | None = None) -> dict[str, Any]:
    nombres = nombres or {}
    return {
        "id": d.id, "titulo": d.titulo, "descripcion": d.descripcion, "archivo": d.archivo_nombre, "mime": d.mime,
        "bytes": d.bytes, "paginas": d.paginas, "alcance": d.alcance or {"tipo": "todos", "permisos": []},
        "activo": d.activo, "caracteres": d.caracteres, "fragmentos": d.fragmentos,
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
        "subido_por": nombres.get(d.created_by or "", None), "editado_por": nombres.get(d.updated_by or "", None),
    }


async def _documento(db: AsyncSession, doc_id: str) -> AsistenteDocumento:
    d = (await db.execute(select(AsistenteDocumento).options(defer(AsistenteDocumento.contenido_gz))
                          .where(AsistenteDocumento.id == doc_id))).scalar_one_or_none()
    if d is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Documento no encontrado")
    return d


def _permisos_catalogo() -> list[dict[str, str]]:
    return [{"clave": f"{o['slug']}.{u['key']}", "nombre": u["name"], "operativa": o["name"]}
            for o in OPERATIVAS for u in o["utilidades"] if u["key"] not in ("ver", "asistente")]


# ------------------------------------------------------------------ superadmin
@admin_router.get("")
async def listar(_: CurrentUser = Depends(require_superadmin), db: AsyncSession = Depends(get_db)) -> dict:
    docs = (await db.execute(select(AsistenteDocumento).options(defer(AsistenteDocumento.contenido_gz))
                             .order_by(AsistenteDocumento.updated_at.desc()))).scalars().all()
    nombres = await _nombres(db, {d.created_by for d in docs} | {d.updated_by for d in docs})
    return {"items": [_dict(d, nombres) for d in docs], "permisos": _permisos_catalogo(),
            "formatos": list(TIPOS), "max_mb": settings.max_upload_size_mb}


@admin_router.post("", status_code=201)
async def subir(request: Request, archivo: UploadFile = File(...), titulo: str = Form(""), descripcion: str = Form(""),
                alcance: str = Form('{"tipo": "todos"}'), user: CurrentUser = Depends(require_superadmin),
                db: AsyncSession = Depends(get_db)) -> dict:
    nombre = _nombre_seguro(archivo.filename)
    contenido = await archivo.read(settings.max_upload_size_mb * 1024 * 1024 + 1)
    extension = _validar_archivo(nombre, contenido)
    alc = _alcance(alcance)
    titulo = (titulo or "").strip()[:200] or PurePath(nombre).stem.replace("_", " ").strip()[:200] or "Documento"
    r = await _extraer(nombre, contenido)
    doc = AsistenteDocumento(titulo=titulo, descripcion=(descripcion or "").strip()[:2000], archivo_nombre=nombre,
                             mime=TIPOS[extension], bytes=len(contenido), paginas=r["paginas"], alcance=alc, activo=True,
                             contenido_gz=gzip.compress(contenido), caracteres=r["caracteres"],
                             fragmentos=len(r["fragmentos"]), created_by=user.id, updated_by=user.id,
                             updated_at=datetime.now(timezone.utc))
    db.add(doc)
    await db.flush()
    db.add_all(conocimiento.construir_fragmentos(doc, r["fragmentos"]))
    await db.commit()
    conocimiento.invalidar()
    await record_action(db, user_id=user.id, action="asistente_documento_subir", resource_type="asistente_documento",
                        resource_id=doc.id, ip=client_ip(request),
                        extra={"titulo": titulo, "archivo": nombre, "alcance": alc, "fragmentos": doc.fragmentos})
    doc = await _documento(db, doc.id)
    return {**_dict(doc, await _nombres(db, {user.id})), "truncado": r["truncado"]}


class EditarDocumento(BaseModel):
    titulo: Optional[str] = Field(None, min_length=1, max_length=200)
    descripcion: Optional[str] = Field(None, max_length=2000)
    alcance: Optional[dict[str, Any]] = None
    activo: Optional[bool] = None


@admin_router.patch("/{doc_id}")
async def editar(doc_id: str, payload: EditarDocumento, request: Request, user: CurrentUser = Depends(require_superadmin),
                 db: AsyncSession = Depends(get_db)) -> dict:
    doc = await _documento(db, doc_id)
    cambios = payload.model_dump(exclude_none=True)
    if "alcance" in cambios:
        try:
            cambios["alcance"] = conocimiento.alcance_valido(cambios["alcance"])
        except ValueError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    if "titulo" in cambios:
        cambios["titulo"] = cambios["titulo"].strip()[:200] or doc.titulo
    if "descripcion" in cambios:
        cambios["descripcion"] = cambios["descripcion"].strip()
    retitular = "titulo" in cambios and cambios["titulo"] != doc.titulo
    for k, v in cambios.items():
        setattr(doc, k, v)
    if retitular:
        await conocimiento.recalcular_terminos(db, doc)
    doc.updated_by, doc.updated_at = user.id, datetime.now(timezone.utc)
    await db.commit()
    conocimiento.invalidar()
    await record_action(db, user_id=user.id, action="asistente_documento_editar", resource_type="asistente_documento",
                        resource_id=doc_id, ip=client_ip(request), extra=cambios)
    doc = await _documento(db, doc_id)
    return _dict(doc, await _nombres(db, {doc.created_by, doc.updated_by}))


@admin_router.post("/{doc_id}/archivo")
async def reemplazar(doc_id: str, request: Request, archivo: UploadFile = File(...),
                     user: CurrentUser = Depends(require_superadmin), db: AsyncSession = Depends(get_db)) -> dict:
    """Sube una versión nueva del documento: mantiene título, descripción y alcance. Las citas viejas dejan de abrir."""
    doc = await _documento(db, doc_id)
    nombre = _nombre_seguro(archivo.filename)
    contenido = await archivo.read(settings.max_upload_size_mb * 1024 * 1024 + 1)
    extension = _validar_archivo(nombre, contenido)
    r = await _extraer(nombre, contenido)
    await db.execute(delete(AsistenteFragmento).where(AsistenteFragmento.documento_id == doc_id))
    doc.archivo_nombre, doc.mime, doc.bytes, doc.paginas = nombre, TIPOS[extension], len(contenido), r["paginas"]
    doc.contenido_gz, doc.caracteres, doc.fragmentos = gzip.compress(contenido), r["caracteres"], len(r["fragmentos"])
    doc.updated_by, doc.updated_at = user.id, datetime.now(timezone.utc)
    db.add_all(conocimiento.construir_fragmentos(doc, r["fragmentos"]))
    await db.commit()
    conocimiento.invalidar()
    await record_action(db, user_id=user.id, action="asistente_documento_reemplazar", resource_type="asistente_documento",
                        resource_id=doc_id, ip=client_ip(request), extra={"archivo": nombre, "fragmentos": doc.fragmentos})
    doc = await _documento(db, doc_id)
    return {**_dict(doc, await _nombres(db, {doc.created_by, doc.updated_by})), "truncado": r["truncado"]}


@admin_router.delete("/{doc_id}")
async def borrar(doc_id: str, request: Request, user: CurrentUser = Depends(require_superadmin),
                 db: AsyncSession = Depends(get_db)) -> dict:
    doc = await _documento(db, doc_id)
    titulo = doc.titulo
    await db.execute(delete(AsistenteFragmento).where(AsistenteFragmento.documento_id == doc_id))
    await db.execute(delete(AsistenteDocumento).where(AsistenteDocumento.id == doc_id))
    await db.commit()
    conocimiento.invalidar()
    await record_action(db, user_id=user.id, action="asistente_documento_borrar", resource_type="asistente_documento",
                        resource_id=doc_id, ip=client_ip(request), extra={"titulo": titulo})
    return {"ok": True}


@admin_router.get("/{doc_id}/fragmentos")
async def fragmentos(doc_id: str, desde: int = Query(0, ge=0), limite: int = Query(30, ge=1, le=100),
                     _: CurrentUser = Depends(require_superadmin), db: AsyncSession = Depends(get_db)) -> dict:
    """El texto que Voi lee de este documento, en orden (para revisar que la extracción salió bien)."""
    doc = await _documento(db, doc_id)
    filas = (await db.execute(select(AsistenteFragmento).where(AsistenteFragmento.documento_id == doc_id)
                              .order_by(AsistenteFragmento.orden).offset(desde).limit(limite))).scalars().all()
    return {"total": doc.fragmentos, "desde": desde,
            "items": [{"id": f.id, "orden": f.orden, "pagina": f.pagina, "seccion": f.seccion, "texto": f.texto}
                      for f in filas]}


class BuscarPayload(BaseModel):
    consulta: str = Field(..., min_length=2, max_length=500)
    incluir_inactivos: bool = False


@admin_router.post("/buscar")
async def probar_busqueda(payload: BuscarPayload, user: CurrentUser = Depends(require_superadmin),
                          db: AsyncSession = Depends(get_db)) -> dict:
    """Lo mismo que encontraría Voi (como superadmin ve todos los documentos activos)."""
    r = await conocimiento.buscar(db, user, payload.consulta, limite=8, incluir_inactivos=payload.incluir_inactivos)
    return {"terminos": conocimiento.palabras_clave(payload.consulta), "items": r}


# ------------------------------------------------------------------ quien usa Voi
@router.get("/citas/{fragmento_id}")
async def ver_cita(fragmento_id: str, user: CurrentUser = Depends(usuario_voi), db: AsyncSession = Depends(get_db)) -> dict:
    p = await conocimiento.pasaje(db, user, fragmento_id[:40])
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ese pasaje ya no está disponible (el documento se actualizó, se "
                                                       "quitó o no está a tu alcance).")
    return p


@router.get("/documentos/{doc_id}/archivo")
async def descargar(doc_id: str, request: Request, user: CurrentUser = Depends(usuario_voi),
                    db: AsyncSession = Depends(get_db)) -> Response:
    fila = (await db.execute(select(AsistenteDocumento).where(AsistenteDocumento.id == doc_id[:40]))).scalar_one_or_none()
    if fila is None or not conocimiento.puede_ver(fila, user) or fila.contenido_gz is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Documento no disponible")
    await record_action(db, user_id=user.id, action="asistente_documento_descargar", resource_type="asistente_documento",
                        resource_id=fila.id, ip=client_ip(request), extra={"titulo": fila.titulo})
    nombre = fila.archivo_nombre or "documento"
    ascii_ = re.sub(r"[^A-Za-z0-9._ -]", "_", nombre) or "documento"
    return Response(gzip.decompress(fila.contenido_gz), media_type=fila.mime or "application/octet-stream", headers={
        "Content-Disposition": f"attachment; filename=\"{ascii_}\"; filename*=UTF-8''{quote(nombre)}",
        "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"})
