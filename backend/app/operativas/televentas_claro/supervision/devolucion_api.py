"""API de la devolución con firma — portal del supervisor (desde el celular).

* Un coaching sin firmar junta monitoreos y feedback (`/items`) y los compromisos del asesor (`/compromisos`), cada uno
  con su texto y, si se dictó, su audio (`/audios`, se transcribe en segundo plano).
* `/firmar`: el supervisor le pasa el celular al asesor, que lee sus compromisos, acepta y firma con el dedo. Queda
  bloqueado, con la huella SHA-256 de lo firmado y las dos firmas. `/comprobante` arma el PDF para compartir.
* Alta de asesores: si no lo encuentra, el supervisor lo carga (`/portal/asesores`), con aviso de parecidos en todo el
  maestro; si está en otro equipo, pide el pase a los jefes.

Todo lo filtra el servidor por el supervisor que entra (`televentas_claro.portal_supervisor`) y queda auditado.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from difflib import SequenceMatcher
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import CurrentUser, client_ip
from ....core.config import settings
from ....core.database import get_db
from ....services.audit_service import record_action
from ..informe_diario import informe as firma_srv
from ..informe_diario.models import InformeFirma
from ..sph.analyzer import tokens
from . import api as sup
from . import audios as audios_srv
from . import coaching as srv
from . import comprobante
from . import operadores as maestro
from .calculo import mes_de, supervisor_en
from .coaching_api import _detalle, _propio, _regla
from .models import (
    ALTA_PENDIENTE, OPERATIVA, Coaching, CoachingAudio, CoachingCompromiso, CoachingFirma, CoachingItem, EquipoAsignacion,
    Operador, PedidoPase,
)

router = APIRouter(prefix="/televentas-claro/supervision", tags=["televentas-claro · devolución con firma"])

TipoItem = Literal["monitoreo", "feedback"]
Metrica = Literal["pospago", "gpon", "uso", "conversacion", "otra"]


def _pendiente(c: Coaching) -> None:
    if c.estado != srv.PENDIENTE:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya está firmado: solo se agregan aclaraciones y el seguimiento"
                            if c.firmado_at else "Este coaching no se puede cambiar")


async def _audio_propio(db: AsyncSession, c: Coaching, audio_id: Optional[str], destino: str) -> Optional[CoachingAudio]:
    if not audio_id:
        return None
    a = await db.get(CoachingAudio, audio_id)
    if not a or a.coaching_id != c.id or a.destino != destino:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ese audio no es de este coaching")
    return a


def _texto_o_audio(texto: Optional[str], audio: Optional[CoachingAudio], campo: str) -> str:
    """El texto escrito; sin texto, el de la transcripción (o vacío: llega solo cuando termine de transcribir)."""
    t = (texto or "").strip()
    if not t and audio is not None:
        return (audio.texto or "").strip()
    try:
        return srv.texto(t, campo, minimo=5)
    except srv.ReglaInvalida as exc:
        raise _regla(exc) from exc


async def _resumir(db: AsyncSession, c: Coaching) -> None:
    srv.resumir(c, await srv.items_de(db, c.id), await srv.compromisos_de(db, c.id))
    c.updated_at = srv.ahora()


# ------------------------------------------------------------------ monitoreos y feedback
class ItemPayload(BaseModel):
    tipo: TipoItem
    metricas: list[Metrica] = Field(..., min_length=1, max_length=5)
    texto: Optional[str] = Field(None, max_length=srv.MAX_TEXTO)
    referencia: Optional[str] = Field(None, max_length=120)
    audio_id: Optional[str] = Field(None, max_length=36)


class ItemPatch(BaseModel):
    tipo: Optional[TipoItem] = None
    metricas: Optional[list[Metrica]] = Field(None, min_length=1, max_length=5)
    texto: Optional[str] = Field(None, max_length=srv.MAX_TEXTO)
    referencia: Optional[str] = Field(None, max_length=120)


@router.post("/portal/coaching/{coaching_id}/items", status_code=status.HTTP_201_CREATED)
async def agregar_item(coaching_id: str, payload: ItemPayload, request: Request, user: CurrentUser = Depends(sup.require_portal),
                       db: AsyncSession = Depends(get_db)) -> dict:
    """Suma un monitoreo de llamada o un feedback (la hora la pone el servidor)."""
    c = await _propio(db, coaching_id, user)
    _pendiente(c)
    n = (await db.execute(select(func.count()).select_from(CoachingItem).where(CoachingItem.coaching_id == c.id))).scalar() or 0
    if n >= srv.MAX_ITEMS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Un coaching puede tener hasta {srv.MAX_ITEMS} monitoreos y feedback")
    try:
        metricas = srv.normalizar_metricas(payload.metricas)
    except srv.ReglaInvalida as exc:
        raise _regla(exc) from exc
    audio = await _audio_propio(db, c, payload.audio_id, "item")
    texto = _texto_o_audio(payload.texto, audio, "lo que observaste")
    i = CoachingItem(coaching_id=c.id, tipo=payload.tipo, at=srv.ahora(), metricas=metricas, texto=texto,
                     referencia=(payload.referencia or "").strip() or None, audio_id=audio.id if audio else None, created_by=user.id)
    db.add(i)
    await db.flush()
    await _resumir(db, c)
    srv.evento(db, c, "item", user.id, item_id=i.id, tipo=i.tipo, metricas=metricas, texto=texto, audio_id=i.audio_id)
    await db.commit()
    await record_action(db, user_id=user.id, action="coaching_item", resource_type="coaching", resource_id=c.id,
                        ip=client_ip(request), extra={"tipo": i.tipo, "con_audio": bool(audio)})
    return await _detalle(db, c, portal=True)


async def _item(db: AsyncSession, c: Coaching, item_id: str) -> CoachingItem:
    i = await db.get(CoachingItem, item_id)
    if not i or i.coaching_id != c.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Monitoreo o feedback no encontrado")
    return i


@router.patch("/portal/coaching/{coaching_id}/items/{item_id}")
async def editar_item(coaching_id: str, item_id: str, payload: ItemPatch, request: Request,
                      user: CurrentUser = Depends(sup.require_portal), db: AsyncSession = Depends(get_db)) -> dict:
    c = await _propio(db, coaching_id, user)
    _pendiente(c)
    i = await _item(db, c, item_id)
    antes = {"tipo": i.tipo, "metricas": list(i.metricas or []), "texto": i.texto, "referencia": i.referencia}
    try:
        if payload.tipo is not None:
            i.tipo = payload.tipo
        if payload.metricas is not None:
            i.metricas = srv.normalizar_metricas(payload.metricas)
        if payload.texto is not None:
            i.texto = srv.texto(payload.texto, "lo que observaste", minimo=5)
        if payload.referencia is not None:
            i.referencia = payload.referencia.strip() or None
    except srv.ReglaInvalida as exc:
        raise _regla(exc) from exc
    i.updated_at = srv.ahora()
    await _resumir(db, c)
    srv.evento(db, c, "item_editado", user.id, item_id=i.id, antes=antes,
               despues={"tipo": i.tipo, "metricas": list(i.metricas or []), "texto": i.texto, "referencia": i.referencia})
    await db.commit()
    await record_action(db, user_id=user.id, action="coaching_item_editado", resource_type="coaching", resource_id=c.id,
                        ip=client_ip(request), extra={"item": i.id})
    return await _detalle(db, c, portal=True)


@router.delete("/portal/coaching/{coaching_id}/items/{item_id}")
async def quitar_item(coaching_id: str, item_id: str, request: Request, user: CurrentUser = Depends(sup.require_portal),
                      db: AsyncSession = Depends(get_db)) -> dict:
    c = await _propio(db, coaching_id, user)
    _pendiente(c)
    i = await _item(db, c, item_id)
    srv.evento(db, c, "item_quitado", user.id, item_id=i.id, tipo=i.tipo, texto=i.texto, audio_id=i.audio_id)
    await db.delete(i)
    await db.flush()
    await _resumir(db, c)
    await db.commit()
    await record_action(db, user_id=user.id, action="coaching_item_quitado", resource_type="coaching", resource_id=c.id,
                        ip=client_ip(request), extra={"item": item_id})
    return await _detalle(db, c, portal=True)


# ------------------------------------------------------------------ compromisos del asesor
class CompromisoPayload(BaseModel):
    texto: Optional[str] = Field(None, max_length=1000)
    para: Optional[date] = None
    metrica: Optional[Metrica] = None
    origen: Literal["asesor", "supervisor"] = "asesor"
    audio_id: Optional[str] = Field(None, max_length=36)


class CompromisoPatch(BaseModel):
    texto: Optional[str] = Field(None, max_length=1000)
    para: Optional[date] = None
    quitar_para: bool = False
    metrica: Optional[Metrica] = None


def _validar_para(para: Optional[date]) -> None:
    hoy = sup.hoy()
    if para and not (hoy <= para <= hoy + timedelta(days=srv.DIAS_SEGUIMIENTO_MAX)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"La fecha del compromiso tiene que ser de hoy a {srv.DIAS_SEGUIMIENTO_MAX} días")


@router.post("/portal/coaching/{coaching_id}/compromisos", status_code=status.HTTP_201_CREATED)
async def agregar_compromiso(coaching_id: str, payload: CompromisoPayload, request: Request,
                             user: CurrentUser = Depends(sup.require_portal), db: AsyncSession = Depends(get_db)) -> dict:
    """Suma un compromiso del asesor (lo puede dictar él: el audio se transcribe)."""
    c = await _propio(db, coaching_id, user)
    _pendiente(c)
    comps = await srv.compromisos_de(db, c.id)
    if len(comps) >= srv.MAX_COMPROMISOS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Hasta {srv.MAX_COMPROMISOS} compromisos por coaching")
    _validar_para(payload.para)
    audio = await _audio_propio(db, c, payload.audio_id, "compromiso")
    texto = _texto_o_audio(payload.texto, audio, "el compromiso")
    x = CoachingCompromiso(coaching_id=c.id, orden=(max((k.orden for k in comps), default=0) + 1), texto=texto, para=payload.para,
                           metrica=payload.metrica, origen="asesor" if (audio and audio.hablante == "asesor") else payload.origen,
                           audio_id=audio.id if audio else None, created_at=srv.ahora(), created_by=user.id)
    db.add(x)
    await db.flush()
    await _resumir(db, c)
    srv.evento(db, c, "compromiso", user.id, compromiso_id=x.id, texto=texto, para=x.para, origen=x.origen, audio_id=x.audio_id)
    await db.commit()
    await record_action(db, user_id=user.id, action="coaching_compromiso", resource_type="coaching", resource_id=c.id,
                        ip=client_ip(request), extra={"origen": x.origen, "con_audio": bool(audio)})
    return await _detalle(db, c, portal=True)


async def _compromiso(db: AsyncSession, c: Coaching, compromiso_id: str) -> CoachingCompromiso:
    x = await db.get(CoachingCompromiso, compromiso_id)
    if not x or x.coaching_id != c.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Compromiso no encontrado")
    return x


@router.patch("/portal/coaching/{coaching_id}/compromisos/{compromiso_id}")
async def editar_compromiso(coaching_id: str, compromiso_id: str, payload: CompromisoPatch, request: Request,
                            user: CurrentUser = Depends(sup.require_portal), db: AsyncSession = Depends(get_db)) -> dict:
    c = await _propio(db, coaching_id, user)
    _pendiente(c)
    x = await _compromiso(db, c, compromiso_id)
    antes = {"texto": x.texto, "para": x.para, "metrica": x.metrica}
    if payload.texto is not None:
        try:
            x.texto = srv.texto(payload.texto, "el compromiso", minimo=5, maximo=1000)
        except srv.ReglaInvalida as exc:
            raise _regla(exc) from exc
    if payload.quitar_para:
        x.para = None
    elif payload.para is not None:
        _validar_para(payload.para)
        x.para = payload.para
    if payload.metrica is not None:
        x.metrica = payload.metrica
    x.updated_at = srv.ahora()
    await _resumir(db, c)
    srv.evento(db, c, "compromiso_editado", user.id, compromiso_id=x.id, antes=antes,
               despues={"texto": x.texto, "para": x.para, "metrica": x.metrica})
    await db.commit()
    await record_action(db, user_id=user.id, action="coaching_compromiso_editado", resource_type="coaching", resource_id=c.id,
                        ip=client_ip(request), extra={"compromiso": x.id})
    return await _detalle(db, c, portal=True)


@router.delete("/portal/coaching/{coaching_id}/compromisos/{compromiso_id}")
async def quitar_compromiso(coaching_id: str, compromiso_id: str, request: Request,
                            user: CurrentUser = Depends(sup.require_portal), db: AsyncSession = Depends(get_db)) -> dict:
    c = await _propio(db, coaching_id, user)
    _pendiente(c)
    x = await _compromiso(db, c, compromiso_id)
    srv.evento(db, c, "compromiso_quitado", user.id, compromiso_id=x.id, texto=x.texto)
    await db.delete(x)
    await db.flush()
    await _resumir(db, c)
    await db.commit()
    await record_action(db, user_id=user.id, action="coaching_compromiso_quitado", resource_type="coaching", resource_id=c.id,
                        ip=client_ip(request), extra={"compromiso": compromiso_id})
    return await _detalle(db, c, portal=True)


# ------------------------------------------------------------------ audios
@router.post("/portal/coaching/{coaching_id}/audios", status_code=status.HTTP_201_CREATED)
async def subir_audio(coaching_id: str, request: Request, archivo: UploadFile = File(...), duracion: float = Form(...),
                      hablante: Literal["supervisor", "asesor"] = Form("supervisor"),
                      destino: Literal["item", "compromiso", "comentario"] = Form("item"),
                      user: CurrentUser = Depends(sup.require_portal), db: AsyncSession = Depends(get_db)) -> dict:
    """Un audio grabado en el celular: se guarda como registro y se transcribe en segundo plano."""
    c = await _propio(db, coaching_id, user)
    _pendiente(c)
    datos = await archivo.read(settings.transcripcion_max_mb * 1024 * 1024 + 1)
    try:
        a = await audios_srv.guardar(db, c=c, user_id=user.id, datos=datos, duracion_s=duracion, hablante=hablante,
                                     destino=destino, momento=srv.ahora())
    except audios_srv.AudioInvalido as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    srv.evento(db, c, "audio", user.id, audio_id=a.id, hablante=hablante, destino=destino, segundos=a.duracion_s, sha256=a.sha256)
    await db.commit()
    audios_srv.despertar()
    await record_action(db, user_id=user.id, action="coaching_audio", resource_type="coaching", resource_id=c.id,
                        ip=client_ip(request), extra={"audio": a.id, "hablante": hablante, "segundos": a.duracion_s,
                                                     "bytes": a.bytes, "sha256": a.sha256})
    return audios_srv.a_dict(a)


async def _audio_del_supervisor(db: AsyncSession, audio_id: str, user: CurrentUser) -> CoachingAudio:
    a = await db.get(CoachingAudio, audio_id)
    if not a or a.supervisor_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Audio no encontrado")
    return a


@router.get("/portal/audios/{audio_id}")
async def estado_audio(audio_id: str, user: CurrentUser = Depends(sup.require_portal), db: AsyncSession = Depends(get_db)) -> dict:
    """Cómo va la transcripción (el celular lo consulta hasta que llega el texto)."""
    return audios_srv.a_dict(await _audio_del_supervisor(db, audio_id, user))


def archivo_audio(a: CoachingAudio) -> FileResponse:
    p = audios_srv.ruta(a.ruta) if a.borrado_at is None else None
    if p is None or not p.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "El audio ya no está guardado (queda su transcripción)")
    return FileResponse(p, media_type=a.mime, headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
                                                       "Content-Disposition": f'inline; filename="audio-{a.id[:8]}.{p.suffix.lstrip(".")}"'})


@router.get("/portal/audios/{audio_id}/archivo")
async def escuchar_audio(audio_id: str, user: CurrentUser = Depends(sup.require_portal), db: AsyncSession = Depends(get_db)) -> FileResponse:
    return archivo_audio(await _audio_del_supervisor(db, audio_id, user))


# ------------------------------------------------------------------ firma guardada del supervisor
class FirmaGuardadaPayload(BaseModel):
    imagen: str = Field(..., max_length=400_000)


@router.get("/portal/firma")
async def mi_firma(user: CurrentUser = Depends(sup.require_portal), db: AsyncSession = Depends(get_db)) -> dict:
    f = await db.get(InformeFirma, user.id)
    return {"imagen": f.imagen if f else None}


@router.put("/portal/firma")
async def guardar_mi_firma(payload: FirmaGuardadaPayload, request: Request, user: CurrentUser = Depends(sup.require_portal),
                           db: AsyncSession = Depends(get_db)) -> dict:
    """La firma del supervisor, para firmar cada devolución de un toque."""
    try:
        imagen = firma_srv.validar_imagen(payload.imagen)
    except firma_srv.ReglaInvalida as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    f = await db.get(InformeFirma, user.id) or InformeFirma(user_id=user.id)
    f.imagen, f.updated_at = imagen, srv.ahora()
    db.add(f)
    await db.commit()
    await record_action(db, user_id=user.id, action="portal_firma_guardada", resource_type="firma", resource_id=user.id,
                        ip=client_ip(request))
    return {"imagen": f.imagen}


# ------------------------------------------------------------------ firma del asesor
class FirmarPayload(BaseModel):
    imagen: str = Field(..., max_length=400_000)                    # la firma del asesor (PNG dibujado)
    acepto: bool
    comentario: Optional[str] = Field(None, max_length=1000)
    comentario_audio_id: Optional[str] = Field(None, max_length=36)
    consentimiento_audio: bool = False                              # aceptó que se grabe su voz
    imagen_supervisor: Optional[str] = Field(None, max_length=400_000)  # sin ella, la firma guardada
    seguimiento_fecha: Optional[date] = None


@router.post("/portal/coaching/{coaching_id}/firmar")
async def firmar(coaching_id: str, payload: FirmarPayload, request: Request, user: CurrentUser = Depends(sup.require_portal),
                 db: AsyncSession = Depends(get_db)) -> dict:
    """El asesor acepta sus compromisos y firma: el coaching queda terminado y bloqueado, con la huella de lo firmado."""
    c = await _propio(db, coaching_id, user)
    _pendiente(c)
    if not payload.acepto:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El asesor tiene que aceptar sus compromisos")
    dia = sup.hoy()
    ctx = await sup.Contexto(mes_de(dia)).cargar(db)
    op = ctx.ops.get(c.operador_id)
    if not op or supervisor_en(ctx.tramos.get(op.id, []), dia) != user.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ese asesor ya no está en tu equipo: no se puede firmar")
    items = await srv.items_de(db, c.id)
    comps = await srv.compromisos_de(db, c.id)
    if not items:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Sumá al menos un monitoreo o feedback")
    if not comps:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Sumá al menos un compromiso del asesor")
    if any(not i.texto for i in items) or any(not x.texto for x in comps):
        raise HTTPException(status.HTTP_409_CONFLICT, "Hay un audio que todavía se está transcribiendo: esperá unos segundos")
    seguimiento = payload.seguimiento_fecha or c.seguimiento_fecha
    if seguimiento <= dia or seguimiento > dia + timedelta(days=srv.DIAS_SEGUIMIENTO_MAX):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Elegí un seguimiento entre mañana y dentro de {srv.DIAS_SEGUIMIENTO_MAX} días")
    try:
        img_asesor = firma_srv.validar_imagen(payload.imagen)
        if payload.imagen_supervisor:
            img_sup = firma_srv.validar_imagen(payload.imagen_supervisor)
        else:
            guardada = await db.get(InformeFirma, user.id)
            if not guardada or not guardada.imagen:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Falta tu firma de supervisor")
            img_sup = guardada.imagen
    except firma_srv.ReglaInvalida as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    auds = {a.id: a for a in (await db.execute(select(CoachingAudio).where(CoachingAudio.coaching_id == c.id))).scalars().all()}
    comentario_audio = None
    if payload.comentario_audio_id:
        comentario_audio = auds.get(payload.comentario_audio_id)
        if not comentario_audio or comentario_audio.destino != "comentario":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ese audio no es el comentario de este coaching")
    hay_voz_asesor = any(a.hablante == "asesor" for a in auds.values())
    if hay_voz_asesor and not payload.consentimiento_audio:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El asesor tiene que aceptar que su voz quede grabada")
    comentario = (payload.comentario or "").strip() or (comentario_audio.texto if comentario_audio and comentario_audio.texto else None)

    momento = srv.ahora()
    c.seguimiento_fecha = seguimiento
    contenido = srv.contenido_firmado(c, items, comps, {i: a.sha256 for i, a in auds.items()}, asesor=op.nombre, firmado_at=momento,
                                      comentario=comentario, comentario_audio=comentario_audio.id if comentario_audio else None)
    h = srv.huella(contenido)
    dispositivo = (request.headers.get("user-agent") or "")[:300] or None
    ip = client_ip(request)
    db.add(CoachingFirma(coaching_id=c.id, firmante="asesor", nombre=op.nombre, imagen=img_asesor, firmado_at=momento, huella=h,
                         acepto=True, comentario=comentario, comentario_audio_id=comentario_audio.id if comentario_audio else None,
                         consentimiento_audio=payload.consentimiento_audio, dispositivo=dispositivo, ip=ip, created_by=user.id))
    db.add(CoachingFirma(coaching_id=c.id, firmante="supervisor", nombre=user.full_name, imagen=img_sup, firmado_at=momento,
                         huella=h, acepto=True, dispositivo=dispositivo, ip=ip, created_by=user.id))
    c.estado, c.firmado_at, c.huella, c.updated_at = "abierto", momento, h, momento
    srv.evento(db, c, "firmado", user.id, huella=h, asesor=op.nombre, seguimiento_fecha=seguimiento, items=len(items),
               compromisos=len(comps), con_comentario=bool(comentario))
    await db.commit()
    await record_action(db, user_id=user.id, action="coaching_firmado", resource_type="coaching", resource_id=c.id, ip=ip,
                        extra={"asesor": op.nombre, "huella": h, "items": len(items), "compromisos": len(comps)})
    return await _detalle(db, c, portal=True)


async def _pdf(db: AsyncSession, c: Coaching) -> Response:
    if not c.firmado_at:
        raise HTTPException(status.HTTP_409_CONFLICT, "El comprobante sale cuando el asesor firma")
    d = await _detalle(db, c, portal=False)
    pdf = comprobante.generar(d)
    nombre = f"coaching-{d['operador'].split(',')[0].strip().lower().replace(' ', '-')}-{d['fecha']}.pdf"
    return Response(pdf, media_type="application/pdf", headers={
        "Content-Disposition": f'inline; filename="{nombre}"', "Cache-Control": "private, no-store"})


@router.get("/portal/coaching/{coaching_id}/comprobante")
async def comprobante_portal(coaching_id: str, user: CurrentUser = Depends(sup.require_portal),
                             db: AsyncSession = Depends(get_db)) -> Response:
    return await _pdf(db, await _propio(db, coaching_id, user))


@router.get("/coaching/{coaching_id}/comprobante")
async def comprobante_jefes(coaching_id: str, user: CurrentUser = Depends(sup.require_ver), db: AsyncSession = Depends(get_db)) -> Response:
    c = await db.get(Coaching, coaching_id)
    if not c or c.operativa != OPERATIVA:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Coaching no encontrado")
    return await _pdf(db, c)


# ------------------------------------------------------------------ alta de asesores y pedidos de pase
def _parecido(q: list[str], palabras: list[str]) -> int:
    """Cuántas palabras de lo que se escribió aparecen en el nombre (tolera errores de escritura en las largas)."""
    usadas: set[int] = set()
    n = 0
    for t in q:
        for i, p in enumerate(palabras):
            if i in usadas:
                continue
            if t == p or (min(len(t), len(p)) >= 5 and SequenceMatcher(None, t, p).ratio() >= 0.85) or \
                    (len(t) >= 3 and p.startswith(t)):
                usadas.add(i)
                n += 1
                break
    return n


async def _parecidos(db: AsyncSession, nombre: str, documento: str | None, user_id: str, tope: int = 6) -> list[dict[str, Any]]:
    q = tokens(nombre)
    doc = (documento or "").strip().upper()
    if not q and not doc:
        return []
    minimo = 1 if len(q) <= 1 else 2
    dia = sup.hoy()
    candidatos: list[tuple[int, Operador]] = []
    for o in await maestro.todos(db):
        if doc and doc in {(o.documento or "").upper(), (o.legajo or "").upper()}:
            candidatos.append((100, o))
            continue
        palabras = sorted(set(tokens(o.nombre)) | set(tokens(o.agente_nombre)) | set(tokens(o.vendedor)))
        n = _parecido(q, palabras)
        if q and n >= minimo:
            candidatos.append((n * 10 + (5 if o.activo else 0), o))
    candidatos.sort(key=lambda t: (-t[0], t[1].nombre.lower()))
    out = []
    nombres = await sup._nombres(db, set())
    for puntos, o in candidatos[:tope]:
        sid = await maestro.supervisor_del_dia(db, o.id, dia)
        if sid and sid not in nombres:
            nombres.update(await sup._nombres(db, {sid}))
        out.append({"id": o.id, "nombre": o.nombre, "subcanal": o.subcanal, "activo": o.activo,
                    "equipo": "tuyo" if sid == user_id else ("otro" if sid else "sin_equipo"),
                    "supervisor": nombres.get(sid) if sid else None, "mismo_documento": puntos == 100,
                    "pase_pedido": bool((await db.execute(select(PedidoPase.id).where(
                        PedidoPase.operador_id == o.id, PedidoPase.pedido_por == user_id, PedidoPase.estado == "pendiente"))).first())})
    return out


@router.get("/portal/asesores/parecidos")
async def parecidos(nombre: str = Query("", max_length=120), documento: Optional[str] = Query(None, max_length=30),
                    user: CurrentUser = Depends(sup.require_portal), db: AsyncSession = Depends(get_db)) -> dict:
    """Personas del maestro que se parecen a la que se quiere dar de alta (para no duplicar)."""
    return {"items": await _parecidos(db, nombre, documento, user.id)}


class AltaPayload(BaseModel):
    nombre: str = Field(..., min_length=5, max_length=120)
    documento: Optional[str] = Field(None, max_length=30, pattern=r"^[0-9A-Za-z.\-]*$")
    subcanal: Optional[str] = Field(None, max_length=20)
    forzar: bool = False   # hay parecidos, pero es otra persona


@router.post("/portal/asesores", status_code=status.HTTP_201_CREATED)
async def alta_asesor(payload: AltaPayload, request: Request, user: CurrentUser = Depends(sup.require_portal),
                      db: AsyncSession = Depends(get_db)) -> dict:
    """Carga un asesor que no está en el maestro: queda en el equipo del supervisor desde hoy y por validar."""
    nombre = " ".join(payload.nombre.split())
    if len(tokens(nombre)) < 2:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Escribí nombre y apellido")
    documento = (payload.documento or "").strip() or None
    parecidos = await _parecidos(db, nombre, documento, user.id)
    if any(p["mismo_documento"] for p in parecidos):
        raise HTTPException(status.HTTP_409_CONFLICT, {"message": "Ya hay un asesor con esa cédula o legajo", "parecidos": parecidos})
    if parecidos and not payload.forzar:
        raise HTTPException(status.HTTP_409_CONFLICT, {"message": "Hay asesores con un nombre parecido", "parecidos": parecidos})
    dia, momento = sup.hoy(), srv.ahora()
    o = Operador(operativa=OPERATIVA, nombre=nombre, nombre_manual=True, cruce=ALTA_PENDIENTE[0], candidatos=[],
                 origen="alta_supervisor", alta_por=user.id, alta_at=momento, documento=documento,
                 subcanal=(payload.subcanal or "").strip().upper() or None, activo=True, primera_vez=dia, ultima_vez=dia,
                 updated_at=momento, updated_by=user.id)
    db.add(o)
    await db.flush()
    db.add(EquipoAsignacion(operativa=OPERATIVA, periodo=dia.strftime("%Y-%m"), operador_id=o.id, supervisor_id=user.id,
                            desde=dia, created_at=momento, created_by=user.id))
    await db.commit()
    await record_action(db, user_id=user.id, action="asesor_alta_supervisor", resource_type="operador", resource_id=o.id,
                        ip=client_ip(request), extra={"nombre": nombre, "documento": bool(documento), "parecidos": len(parecidos)})
    return {"operador": sup._op_corto(o), "parecidos": parecidos}


class PasePayload(BaseModel):
    nota: Optional[str] = Field(None, max_length=500)


@router.post("/portal/asesores/{operador_id}/pase", status_code=status.HTTP_201_CREATED)
async def pedir_pase(operador_id: str, payload: PasePayload, request: Request, user: CurrentUser = Depends(sup.require_portal),
                     db: AsyncSession = Depends(get_db)) -> dict:
    """Pide a los jefes que le pasen a su equipo un asesor que figura en otro (o sin equipo)."""
    o = await db.get(Operador, operador_id)
    if not o or o.operativa != OPERATIVA:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Asesor no encontrado")
    dia = sup.hoy()
    actual = await maestro.supervisor_del_dia(db, o.id, dia)
    if actual == user.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya está en tu equipo")
    ya = (await db.execute(select(PedidoPase).where(PedidoPase.operador_id == o.id, PedidoPase.pedido_por == user.id,
                                                    PedidoPase.estado == "pendiente"))).scalars().first()
    if ya:
        return {"id": ya.id, "estado": ya.estado, "ya_estaba": True}
    x = PedidoPase(operador_id=o.id, pedido_por=user.id, supervisor_actual=actual, nota=(payload.nota or "").strip() or None,
                   created_at=srv.ahora())
    db.add(x)
    await db.commit()
    await record_action(db, user_id=user.id, action="asesor_pedido_pase", resource_type="operador", resource_id=o.id,
                        ip=client_ip(request), extra={"supervisor_actual": actual})
    return {"id": x.id, "estado": x.estado, "ya_estaba": False}
