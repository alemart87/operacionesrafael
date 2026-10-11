"""API de los modos de Voi: activar el modo auditor (con el informe destino) o el modo informe diario desde el panel, y
sumar piezas del lienzo a un informe de auditoría o al informe diario."""
from __future__ import annotations

from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.deps import CurrentUser, client_ip, get_current_user
from ..core.database import get_db
from ..operativas.televentas_claro.auditoria import evidencias
from ..operativas.televentas_claro.informe_diario import figuras as fig_srv
from ..operativas.televentas_claro.informe_diario import informe as inf_srv
from ..operativas.televentas_claro.informe_diario.models import InformeDiario
from ..services.audit_service import record_action
from . import transcripcion
from .investigacion import activar, activar_informe, desactivar, informe, pieza, puede_investigar, publicar
from .investigacion import estado as estado_inv
from .investigacion import tipo as tipo_inv
from .models import AsistenteConversacion
from .permisos import puede_usar

router = APIRouter(prefix="/asistente", tags=["asistente"])


async def usuario_voi(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not puede_usar(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Tu perfil no tiene habilitado el asistente Voi.")
    return user


class InvestigacionPayload(BaseModel):
    activo: bool = True
    tipo: Literal["auditor", "informe_diario"] = "auditor"
    auditoria_id: Optional[str] = Field(None, max_length=40)
    informe_id: Optional[str] = Field(None, max_length=36)
    fecha: Optional[str] = Field(None, max_length=10)


async def _conv_propia(db: AsyncSession, cid: str, user: CurrentUser) -> AsistenteConversacion:
    conv = await db.get(AsistenteConversacion, cid)
    if conv is None or conv.user_id != user.id or conv.oculta:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")
    return conv


@router.post("/conversaciones/{cid}/investigacion")
async def cambiar_investigacion(cid: str, payload: InvestigacionPayload, request: Request,
                                db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(usuario_voi)) -> dict:
    """Activa o desactiva un modo de la conversación: auditor (con el informe destino) o informe diario (con el
    borrador del día, que se crea si no existe)."""
    conv = await _conv_propia(db, cid, user)
    tipo = payload.tipo if payload.activo else tipo_inv(estado_inv(conv))      # al apagar, el modo que estaba activo
    if payload.activo and payload.tipo == "informe_diario":
        try:
            inv = await activar_informe(db, conv, user, payload.informe_id, payload.fecha, por="usuario")
        except ValueError as exc:
            codigo = status.HTTP_403_FORBIDDEN if "es para quien" in str(exc) else status.HTTP_409_CONFLICT
            raise HTTPException(codigo, str(exc)) from exc
    elif payload.activo:
        if not puede_investigar(user):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "El modo auditor es para quien tiene la utilidad Auditoría de ventas.")
        try:
            inv = await activar(db, conv, user, payload.auditoria_id, por="usuario", conservar_destino=not payload.auditoria_id)
        except ValueError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    else:
        desactivar(conv)
        inv = None
    await db.commit()
    publicar(cid, inv)
    await record_action(db, user_id=user.id, action=f"asistente_modo_{tipo}", resource_type="asistente_conversacion",
                        resource_id=cid, ip=client_ip(request),
                        extra={"activo": bool(inv), "informe": (inv or {}).get("codigo") or (inv or {}).get("fecha")})
    return transcripcion.conversacion_dict(await db.get(AsistenteConversacion, cid))


class PiezaPayload(BaseModel):
    artefacto_id: Optional[str] = Field(None, max_length=40)
    widget: Optional[int] = Field(None, ge=0, le=7)
    spec: Optional[dict[str, Any]] = None
    titulo: Optional[str] = Field(None, max_length=255)
    nota: Optional[str] = Field(None, max_length=4000)
    hallazgo_id: Optional[str] = Field(None, max_length=36)


class SumarPayload(BaseModel):
    auditoria_id: Optional[str] = Field(None, max_length=40)
    informe_diario_id: Optional[str] = Field(None, max_length=36)
    conversacion_id: Optional[str] = Field(None, max_length=36)
    piezas: list[PiezaPayload] = Field(..., min_length=1, max_length=12)

    @model_validator(mode="after")
    def _un_destino(self) -> "SumarPayload":
        if bool(self.auditoria_id) == bool(self.informe_diario_id):
            raise ValueError("Indicá el informe de auditoría o el informe diario (uno de los dos).")
        return self


@router.post("/evidencias")
async def sumar_al_informe(payload: SumarPayload, request: Request, db: AsyncSession = Depends(get_db),
                           user: CurrentUser = Depends(usuario_voi)) -> dict:
    """Suma piezas del lienzo (elegidas por el usuario) como figuras de un informe de auditoría o del informe diario."""
    if payload.informe_diario_id:
        return await _sumar_al_informe_diario(payload, request, db, user)
    if not puede_investigar(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "El modo auditor es para quien tiene la utilidad Auditoría de ventas.")
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
    return {"informe": {"id": a.id, "codigo": a.codigo, "titulo": a.titulo, "tipo": "auditor",
                        "pantalla": f"/televentas-claro/auditoria/informes/{a.id}#evidencia"},
            "agregadas": [{"id": e.id, "figura": numero.get(e.id), "titulo": e.titulo} for e in agregadas],
            "repetidas": [{"id": e.id, "figura": numero.get(e.id), "titulo": e.titulo} for e in repetidas]}


def informe_diario_destino(inf: InformeDiario) -> dict[str, Any]:
    """Cómo se nombra el informe diario como destino de figuras (el panel, el lienzo y las tarjetas lo muestran)."""
    return {"id": inf.id, "codigo": f"Informe diario · {inf.fecha:%d/%m}", "titulo": f"Informe diario del {inf.fecha:%d/%m/%Y}",
            "tipo": "informe_diario", "pantalla": f"/televentas-claro/informe-diario/{inf.id}#figuras"}


async def _sumar_al_informe_diario(payload: SumarPayload, request: Request, db: AsyncSession, user: CurrentUser) -> dict:
    inf = await db.get(InformeDiario, payload.informe_diario_id)
    if inf is None or not (user.is_superadmin or inf.autor_id == user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Informe diario no encontrado")
    agregadas, repetidas = [], []
    try:
        for p in payload.piezas:
            v = await pieza(db, user, artefacto_id=p.artefacto_id, widget=p.widget, spec=p.spec,
                            conversacion_id=payload.conversacion_id)
            f, nueva = fig_srv.sumar(inf, v["spec"], user_id=user.id, titulo=p.titulo, nota=p.nota, origen="lienzo",
                                     conversacion_id=v["conversacion_id"], artefacto_id=v["artefacto_id"])
            (agregadas if nueva else repetidas).append(f)
        inf.updated_at = inf_srv.ahora()
        await db.commit()
    except fig_srv.FiguraError as exc:
        await db.rollback()
        raise HTTPException(exc.codigo, str(exc)) from exc
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    numero = {f["id"]: i + 1 for i, f in enumerate(fig_srv.listar(inf))}
    await record_action(db, user_id=user.id, action="asistente_figura_informe_diario", resource_type="informe_diario",
                        resource_id=inf.id, ip=client_ip(request),
                        extra={"fecha": inf.fecha.isoformat(), "figuras": len(agregadas), "repetidas": len(repetidas), "via": "lienzo"})
    return {"informe": informe_diario_destino(inf),
            "agregadas": [{"id": f["id"], "figura": numero.get(f["id"]), "titulo": f["titulo"]} for f in agregadas],
            "repetidas": [{"id": f["id"], "figura": numero.get(f["id"]), "titulo": f["titulo"]} for f in repetidas]}
