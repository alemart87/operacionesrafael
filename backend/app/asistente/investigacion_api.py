"""API del modo auditor: activarlo desde el panel (con el informe destino) y sumar piezas del lienzo a un informe."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.deps import CurrentUser, client_ip, get_current_user
from ..core.database import get_db
from ..operativas.televentas_claro.auditoria import evidencias
from ..services.audit_service import record_action
from . import transcripcion
from .investigacion import activar, desactivar, informe, pieza, puede_investigar, publicar
from .models import AsistenteConversacion
from .permisos import puede_usar

router = APIRouter(prefix="/asistente", tags=["asistente"])


async def usuario_auditor(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not puede_usar(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Tu perfil no tiene habilitado el asistente Voi.")
    if not puede_investigar(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "El modo auditor es para quien tiene la utilidad Auditoría de ventas.")
    return user


class InvestigacionPayload(BaseModel):
    activo: bool = True
    auditoria_id: Optional[str] = Field(None, max_length=40)


async def _conv_propia(db: AsyncSession, cid: str, user: CurrentUser) -> AsistenteConversacion:
    conv = await db.get(AsistenteConversacion, cid)
    if conv is None or conv.user_id != user.id or conv.oculta:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")
    return conv


@router.post("/conversaciones/{cid}/investigacion")
async def cambiar_investigacion(cid: str, payload: InvestigacionPayload, request: Request,
                                db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(usuario_auditor)) -> dict:
    """Activa o desactiva el modo auditor de una conversación (y elige el informe destino)."""
    conv = await _conv_propia(db, cid, user)
    if payload.activo:
        try:
            inv = await activar(db, conv, user, payload.auditoria_id, por="usuario", conservar_destino=not payload.auditoria_id)
        except ValueError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    else:
        desactivar(conv)
        inv = None
    await db.commit()
    publicar(cid, inv)
    await record_action(db, user_id=user.id, action="asistente_modo_auditor", resource_type="asistente_conversacion",
                        resource_id=cid, ip=client_ip(request),
                        extra={"activo": bool(inv), "informe": (inv or {}).get("codigo")})
    return transcripcion.conversacion_dict(await db.get(AsistenteConversacion, cid))


class PiezaPayload(BaseModel):
    artefacto_id: Optional[str] = Field(None, max_length=40)
    widget: Optional[int] = Field(None, ge=0, le=7)
    spec: Optional[dict[str, Any]] = None
    titulo: Optional[str] = Field(None, max_length=255)
    nota: Optional[str] = Field(None, max_length=4000)
    hallazgo_id: Optional[str] = Field(None, max_length=36)


class SumarPayload(BaseModel):
    auditoria_id: str = Field(..., max_length=40)
    conversacion_id: Optional[str] = Field(None, max_length=36)
    piezas: list[PiezaPayload] = Field(..., min_length=1, max_length=12)


@router.post("/evidencias")
async def sumar_al_informe(payload: SumarPayload, request: Request, db: AsyncSession = Depends(get_db),
                           user: CurrentUser = Depends(usuario_auditor)) -> dict:
    """Suma piezas del lienzo (elegidas por el usuario) como figuras de un informe de auditoría."""
    a = await informe(db, payload.auditoria_id)
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Informe de auditoría no encontrado")
    agregadas, repetidas = [], []
    try:
        for p in payload.piezas:
            v = await pieza(db, user, artefacto_id=p.artefacto_id, widget=p.widget, spec=p.spec,
                            conversacion_id=payload.conversacion_id)
            e, nueva = await evidencias.crear_grafico(
                db, a, v["spec"], user_id=user.id, titulo=p.titulo, nota=p.nota, hallazgo_id=p.hallazgo_id,
                origen="lienzo", conversacion_id=v["conversacion_id"], artefacto_id=v["artefacto_id"])
            (agregadas if nueva else repetidas).append(e)
        await db.commit()
    except evidencias.EvidenciaError as exc:
        await db.rollback()
        raise HTTPException(exc.codigo, str(exc)) from exc
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    todas = await evidencias.listar(db, a.id)
    numero = {e.id: i + 1 for i, e in enumerate(todas)}
    await record_action(db, user_id=user.id, action="asistente_evidencia_informe", resource_type="auditoria",
                        resource_id=a.id, ip=client_ip(request),
                        extra={"informe": a.codigo, "figuras": len(agregadas), "repetidas": len(repetidas), "via": "lienzo"})
    return {"informe": {"id": a.id, "codigo": a.codigo, "titulo": a.titulo},
            "agregadas": [{"id": e.id, "figura": numero.get(e.id), "titulo": e.titulo} for e in agregadas],
            "repetidas": [{"id": e.id, "figura": numero.get(e.id), "titulo": e.titulo} for e in repetidas]}
