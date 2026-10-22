"""Entrenamientos con IA: el mentor o el capacitador arma casos (clientes simulados con su actitud al detalle), los
prueba, los envía a los postulantes (que los hacen desde su mismo link) y la IA evalúa cada caso y el entrenamiento.

Reglas:
- Los crean y usan el capacitador, el mentor y la gestión; los edita quien los creó o la gestión. Se envían solo a
  postulantes activos de grupos donde el usuario tiene un papel.
- Cada conversación guarda el caso tal como era al empezar (si después se edita, la evaluación no cambia de reglas).
- El postulante puede mandar varios mensajes seguidos (llegan juntos, como un lote, después de una pausa natural) y el
  cliente contesta a todos de 1 a 3 mensajes. Una respuesta a la vez por conversación; cada lote tiene una marca para
  que un reenvío (si se cortó la conexión con la respuesta en camino) no duplique nada. Tope de respuestas por día y de
  largo de cada mensaje.
- La evaluación corre en segundo plano (worker `capacitacion_entrenamientos`) y mira solo las conversaciones (el IPV es
  independiente): por caso, si la información fue correcta y el nivel comercial de 1 a 10; al terminar todos los casos,
  la evaluación final con dos criterios: perfil comercial (nivel promedio de `umbral_nivel` o más) e información correcta
  (en al menos `umbral_info` % de los casos). Con los dos se aprueba y se recomienda la incorporación. Esa decisión la
  toman las reglas; la IA escribe el resumen de qué mejorar.
"""
from __future__ import annotations

import asyncio
import logging
import secrets
from datetime import timedelta
from statistics import mean
from typing import Any, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...api.deps import CurrentUser, client_ip
from ...core.database import AsyncSessionLocal, get_db
from ...services import seguridad as seg
from ...services.audit_service import record_action
from . import entrenamiento_ia as ia
from . import servicio as srv
from .api import DIAS_LINK, _hash, _origen, require_ver
from .models import CapAsignacion, CapCaso, CapEnlace, CapEntrenamiento, CapGrupo, CapPostulante, CapSesion

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/capacitacion", tags=["capacitación · entrenamientos"])

MAX_CASOS = 30
MAX_TEXTO = 1000
MAX_LOTE = 6          # mensajes seguidos del postulante en una sola vuelta
MAX_INTENTOS = 3
LOTE = 4
_despertar = asyncio.Event()
_candados: dict[str, asyncio.Lock] = {}


def candado(sid: str) -> asyncio.Lock:
    """Una respuesta a la vez por conversación (dentro del proceso)."""
    if len(_candados) > 2000:
        for k in [k for k, v in _candados.items() if not v.locked()][:1000]:
            _candados.pop(k, None)
    return _candados.setdefault(sid, asyncio.Lock())


def despertar() -> None:
    _despertar.set()


# ------------------------------------------------------------------ permisos
def puede_crear(user: CurrentUser) -> bool:
    return srv.es_gestion(user) or user.has_perm(srv.PERM_CAPACITAR) or user.has_perm(srv.PERM_MENTORIA)


def puede_editar(user: CurrentUser, e: CapEntrenamiento) -> bool:
    return srv.es_gestion(user) or e.created_by == user.id


def _exigir_staff(user: CurrentUser) -> None:
    if not puede_crear(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No tenés acceso a los entrenamientos")


async def _entrenamiento(db: AsyncSession, eid: str, user: CurrentUser, *, editar: bool = False) -> CapEntrenamiento:
    _exigir_staff(user)
    e = await db.get(CapEntrenamiento, eid)
    if not e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entrenamiento no encontrado")
    if editar and not puede_editar(user, e):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Lo puede cambiar quien lo creó o la gestión")
    return e


async def _casos(db: AsyncSession, eid: str) -> list[CapCaso]:
    return list((await db.execute(select(CapCaso).where(CapCaso.entrenamiento_id == eid)
                                  .order_by(CapCaso.orden, CapCaso.created_at))).scalars().all())


# ------------------------------------------------------------------ formatos
def caso_dict(c: CapCaso) -> dict[str, Any]:
    return {"id": c.id, "orden": c.orden, "titulo": c.titulo, "cliente_nombre": c.cliente_nombre, "cliente_edad": c.cliente_edad,
            "situacion": c.situacion, "objetivo": c.objetivo, "actitud": c.actitud or {}, "objeciones": c.objeciones or [],
            "info_correcta": c.info_correcta or [], "primer_mensaje": c.primer_mensaje, "detalles": c.detalles,
            "max_turnos": c.max_turnos}


def snapshot(c: CapCaso, e: CapEntrenamiento) -> dict[str, Any]:
    """El caso y el contexto del entrenamiento tal como estaban al empezar la conversación."""
    return {**caso_dict(c), "entrenamiento": {"id": e.id, "nombre": e.nombre, "producto": e.producto, "empresa": e.empresa,
                                              "canal": e.canal}}


def sesion_publica(s: CapSesion) -> dict[str, Any]:
    """Lo que ve el postulante: la charla y el estado (nunca la evaluación ni la configuración del caso)."""
    c = s.caso or {}
    return {"id": s.id, "caso_id": s.caso_id, "titulo": c.get("titulo"), "cliente": c.get("cliente_nombre"),
            "estado": "terminada" if s.estado in srv.HECHOS else s.estado, "fin_motivo": s.fin_motivo,
            "mensajes": s.mensajes or [], "iniciado_at": srv.iso(s.iniciado_at), "terminado_at": srv.iso(s.terminado_at),
            "turnos": ia.turnos(s.mensajes or []), "max_turnos": c.get("max_turnos")}


def sesion_staff(s: CapSesion) -> dict[str, Any]:
    c = s.caso or {}
    return {**sesion_publica(s), "estado": s.estado, "evaluacion": s.evaluacion, "segundos": s.segundos,
            "costo_usd": s.costo_usd, "error": s.error, "prueba": s.prueba_por is not None,
            # Para quien mira la conversación (en vivo o después): qué tenía que lograr y qué datos tenía que dar bien.
            "entrenamiento": (c.get("entrenamiento") or {}).get("nombre"), "objetivo": c.get("objetivo"),
            "situacion": c.get("situacion"), "info_correcta": c.get("info_correcta") or []}


def entrenamiento_dict(e: CapEntrenamiento, casos: list[CapCaso], user: CurrentUser, quien: dict[str, str]) -> dict[str, Any]:
    return {"id": e.id, "nombre": e.nombre, "instrucciones": e.instrucciones, "producto": e.producto, "empresa": e.empresa,
            "canal": e.canal, "umbral_info": e.umbral_info, "umbral_nivel": e.umbral_nivel, "estado": e.estado,
            "creado_por": quien.get(e.created_by, "—"), "created_at": srv.iso(e.created_at), "updated_at": srv.iso(e.updated_at),
            "casos": [caso_dict(c) for c in casos], "puede_editar": puede_editar(user, e)}


# ------------------------------------------------------------------ la conversación
def _msg(r: str, t: str) -> dict[str, Any]:
    return {"r": r, "t": t, "at": srv.iso(srv.ahora())}


def _sumar_consumo(s: CapSesion, r: dict[str, Any]) -> None:
    s.tokens_entrada = (s.tokens_entrada or 0) + int(r.get("tokens_entrada") or 0)
    s.tokens_salida = (s.tokens_salida or 0) + int(r.get("tokens_salida") or 0)
    s.costo_usd = ia.costo(s.tokens_entrada, s.tokens_salida)
    if r.get("modelo"):
        s.modelo = r["modelo"]


def _error_ia(exc: Exception) -> HTTPException:
    if isinstance(exc, ia.SinServicio):
        return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Los entrenamientos con IA no están activos ahora. Avisá a tu capacitador.")
    logger.warning("Entrenamiento: el cliente no respondió (%s)", type(exc).__name__)
    return HTTPException(status.HTTP_502_BAD_GATEWAY, "El cliente no pudo responder. Probá de nuevo en unos segundos.")


async def abrir(db: AsyncSession, *, e: CapEntrenamiento, c: CapCaso, asignacion: Optional[CapAsignacion] = None,
                postulante_id: Optional[str] = None, prueba_por: Optional[str] = None) -> CapSesion:
    """Empieza una conversación: el cliente escribe primero (su primer mensaje configurado o el que arme la IA)."""
    s = CapSesion(asignacion_id=asignacion.id if asignacion else None, caso_id=c.id, postulante_id=postulante_id,
                  prueba_por=prueba_por, estado="en_curso", caso=snapshot(c, e), mensajes=[], iniciado_at=srv.ahora())
    if c.primer_mensaje and c.primer_mensaje.strip():
        s.mensajes = [_msg("cliente", t.strip()) for t in c.primer_mensaje.split("\n\n") if t.strip()][:ia.MAX_MENSAJES]
    else:
        try:
            r = await ia.responder(s.caso, [], empresa=e.empresa, canal=e.canal)
        except Exception as exc:  # noqa: BLE001 — se informa al usuario
            raise _error_ia(exc) from exc
        s.mensajes = [_msg("cliente", t) for t in r["mensajes"]]
        _sumar_consumo(s, r)
    db.add(s)
    await db.flush()
    return s


def _ya_respondido(s: CapSesion, lote: str) -> Optional[dict[str, Any]]:
    """Si ese lote ya se guardó (la respuesta se perdió en el camino), lo que el cliente contestó entonces."""
    ms = list(s.mensajes or [])
    idx = [i for i, m in enumerate(ms) if m.get("lote") == lote]
    if not idx:
        return None
    nuevos = []
    for m in ms[idx[-1] + 1:]:
        if m["r"] != "cliente":
            break
        nuevos.append(m["t"])
    fin = s.estado != "en_curso" and idx[-1] + 1 + len(nuevos) == len(ms)
    return {"nuevos": nuevos, "fin": fin, "motivo": s.fin_motivo if fin else None, "repetido": True}


async def turno(db: AsyncSession, s: CapSesion, textos: list[str], lote: Optional[str] = None) -> dict[str, Any]:
    """El asesor escribe uno o varios mensajes seguidos y el cliente contesta a todos. Si la IA falla, no se guarda nada
    (los mensajes quedan para reintentar con el mismo lote)."""
    if lote and (previo := _ya_respondido(s, lote)) is not None:
        return previo
    if s.estado != "en_curso":
        raise HTTPException(status.HTTP_409_CONFLICT, "Esta conversación ya terminó")
    textos = [t.strip() for t in textos if t and t.strip()]
    if not textos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Escribí un mensaje")
    if len(textos) > MAX_LOTE or any(len(t) > MAX_TEXTO for t in textos):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Cada mensaje puede tener hasta {MAX_TEXTO} caracteres")
    previos = list(s.mensajes or [])
    if previos and previos[-1]["r"] == "asesor":
        raise HTTPException(status.HTTP_409_CONFLICT, "Esperá la respuesta del cliente")
    nuevos = [{**_msg("asesor", t), **({"lote": lote} if lote else {})} for t in textos]
    c = s.caso
    try:
        r = await ia.responder(c, previos + nuevos, empresa=c["entrenamiento"]["empresa"], canal=c["entrenamiento"]["canal"])
    except Exception as exc:  # noqa: BLE001
        raise _error_ia(exc) from exc
    s.mensajes = previos + nuevos + [_msg("cliente", t) for t in r["mensajes"]]
    _sumar_consumo(s, r)
    if r["fin"]:
        cerrar(s, r["motivo"])
    return {"nuevos": r["mensajes"], "fin": r["fin"], "motivo": r["motivo"] if r["fin"] else None}


def cerrar(s: CapSesion, motivo: str) -> None:
    s.estado, s.fin_motivo, s.terminado_at = "evaluando", motivo, srv.ahora()
    s.segundos = max(0, int((s.terminado_at - srv.utc(s.iniciado_at)).total_seconds()))


async def evaluar_sesion(s: CapSesion) -> None:
    """Evalúa una conversación cerrada (sin commit)."""
    c = s.caso
    ev = await ia.evaluar_caso(c, s.mensajes or [], empresa=c["entrenamiento"]["empresa"], producto=c["entrenamiento"]["producto"])
    _sumar_consumo(s, ev)
    s.evaluacion = {k: v for k, v in ev.items() if k not in ("tokens_entrada", "tokens_salida")}
    s.evaluacion["evaluado_at"] = srv.iso(srv.ahora())
    s.estado, s.error = "terminada", None


async def respuestas_hoy(db: AsyncSession, pid: str) -> int:
    """Cuántas veces contestó hoy el cliente simulado a este postulante (el tope de costo por día)."""
    desde = srv.inicio_del_dia()
    filas = (await db.execute(select(CapSesion.mensajes).where(CapSesion.postulante_id == pid, CapSesion.iniciado_at >= desde))).scalars().all()
    return sum(ia.turnos(ms or []) for ms in filas)


async def actualizar_asignacion(db: AsyncSession, a: CapAsignacion) -> None:
    """Después de cerrar un caso: si ya hizo todos, la asignación pasa a evaluarse."""
    casos = {cid for (cid,) in (await db.execute(select(CapCaso.id).where(CapCaso.entrenamiento_id == a.entrenamiento_id))).all()}
    hechos = {cid for (cid,) in (await db.execute(select(CapSesion.caso_id).where(
        CapSesion.asignacion_id == a.id, CapSesion.estado.in_(srv.HECHOS)))).all()}
    if casos and casos <= hechos:
        a.estado = "evaluando"
    elif a.estado == "pendiente":
        a.estado = "en_curso"


# ------------------------------------------------------------------ evaluación final
def metricas(evals: list[dict[str, Any]], e: CapEntrenamiento) -> dict[str, Any]:
    n = len(evals)
    ok = sum(1 for x in evals if x.get("info_correcta"))
    info_pct = round(ok / n * 100, 1) if n else 0.0
    nivel = round(mean(x.get("nivel", 1) for x in evals), 1) if n else 0.0
    # Los dos criterios, por separado: perfil comercial (nivel de las conversaciones) e información correcta.
    perfil_comercial = n > 0 and nivel >= e.umbral_nivel
    informacion = n > 0 and info_pct >= e.umbral_info
    aprobado = perfil_comercial and informacion
    return {"casos": n, "info_ok": ok, "info_pct": info_pct, "nivel_promedio": nivel, "perfil_comercial": perfil_comercial,
            "informacion_correcta": informacion, "aprobado": aprobado,
            "recomendacion": "incorporar" if aprobado else "no_incorporar", "umbral_info": e.umbral_info,
            "umbral_nivel": e.umbral_nivel}


async def evaluar_asignacion(db: AsyncSession, a: CapAsignacion) -> None:
    e = await db.get(CapEntrenamiento, a.entrenamiento_id)
    sesiones = (await db.execute(select(CapSesion).where(CapSesion.asignacion_id == a.id, CapSesion.estado == "terminada")
                                 .order_by(CapSesion.terminado_at))).scalars().all()
    ultima: dict[str, CapSesion] = {}
    for s in sesiones:
        ultima[s.caso_id] = s
    evals = [s.evaluacion for s in ultima.values() if s.evaluacion]
    m = metricas(evals, e)
    a.intentos_eval = (a.intentos_eval or 0) + 1
    try:
        r = await ia.evaluar_final(evals, empresa=e.empresa, nombre=e.nombre, aprobado=m["aprobado"],
                                   umbral_info=e.umbral_info, umbral_nivel=e.umbral_nivel)
    except Exception as exc:  # noqa: BLE001
        if a.intentos_eval < MAX_INTENTOS:
            logger.warning("Entrenamiento: falló la evaluación final de %s (%s)", a.id, type(exc).__name__)
            return
        r = {"resumen": "No se pudo generar el resumen con IA: se muestran los resultados de cada caso.",
             "fuertes": [], "mejorar": list(dict.fromkeys(x for ev in evals for x in ev.get("mejorar", [])))[:4], "modelo": None}
    a.resultado = {**m, "resumen": r["resumen"], "fuertes": r["fuertes"], "mejorar": r["mejorar"],
                   "segundos": sum(s.segundos or 0 for s in ultima.values()), "costo_usd": round(sum(s.costo_usd or 0 for s in sesiones), 4),
                   "modelo": r.get("modelo"), "evaluado_at": srv.iso(srv.ahora())}
    a.estado, a.terminado_at = "terminado", srv.ahora()
    p = await db.get(CapPostulante, a.postulante_id)
    if p:
        srv.evento(db, grupo_id=a.grupo_id, postulante_id=p.id, tipo="entrenamiento", por=None, a="aprobado" if m["aprobado"] else "no_aprobado",
                   entrenamiento=e.nombre, nivel=m["nivel_promedio"], info_pct=m["info_pct"])


async def procesar_pendientes(limite: int = LOTE) -> int:
    """Evalúa conversaciones cerradas y, si corresponde, cierra el entrenamiento. Devuelve cuántas cosas procesó."""
    n = 0
    async with AsyncSessionLocal() as db:
        sesiones = (await db.execute(select(CapSesion).where(CapSesion.estado == "evaluando", CapSesion.asignacion_id.isnot(None),
                                                             CapSesion.intentos_eval < MAX_INTENTOS)
                                     .order_by(CapSesion.terminado_at).limit(limite))).scalars().all()
        for s in sesiones:
            s.intentos_eval = (s.intentos_eval or 0) + 1
            try:
                await evaluar_sesion(s)
            except Exception as exc:  # noqa: BLE001 — se anota y se reintenta
                motivo = "sin servicio de IA" if isinstance(exc, ia.SinServicio) else type(exc).__name__
                logger.warning("Entrenamiento: falló la evaluación de la sesión %s (intento %s): %s", s.id, s.intentos_eval, motivo)
                s.error = motivo[:300]
                if s.intentos_eval >= MAX_INTENTOS:
                    s.estado = "error"
            await db.commit()
            n += 1
        asignaciones = (await db.execute(select(CapAsignacion).where(CapAsignacion.estado == "evaluando").limit(limite))).scalars().all()
        for a in asignaciones:
            pendientes = (await db.execute(select(func.count()).select_from(CapSesion).where(
                CapSesion.asignacion_id == a.id, CapSesion.estado == "evaluando"))).scalar() or 0
            if pendientes:
                continue
            await evaluar_asignacion(db, a)
            await db.commit()
            n += 1
    return n


async def worker() -> None:
    while True:
        try:
            await asyncio.wait_for(_despertar.wait(), timeout=20)
        except asyncio.TimeoutError:
            pass
        _despertar.clear()
        if not ia.servicio_disponible():
            continue
        while await procesar_pendientes():
            pass


# ================================================================== API del equipo
class EntrenamientoDatos(BaseModel):
    nombre: str = Field(min_length=2, max_length=120)
    instrucciones: Optional[str] = Field(None, max_length=2000)
    producto: str = Field("", max_length=20000)
    empresa: str = Field("Claro", min_length=2, max_length=80)
    canal: Literal["chat", "whatsapp", "llamada"] = "whatsapp"
    umbral_info: int = Field(90, ge=50, le=100)
    umbral_nivel: int = Field(8, ge=1, le=10)


class EntrenamientoEditar(BaseModel):
    nombre: Optional[str] = Field(None, min_length=2, max_length=120)
    instrucciones: Optional[str] = Field(None, max_length=2000)
    producto: Optional[str] = Field(None, max_length=20000)
    empresa: Optional[str] = Field(None, min_length=2, max_length=80)
    canal: Optional[Literal["chat", "whatsapp", "llamada"]] = None
    umbral_info: Optional[int] = Field(None, ge=50, le=100)
    umbral_nivel: Optional[int] = Field(None, ge=1, le=10)
    estado: Optional[Literal["borrador", "activo", "archivado"]] = None


def _lista(v: list[str], maximo: int, largo: int) -> list[str]:
    return [x.strip()[:largo] for x in v if x and x.strip()][:maximo]


class Actitud(BaseModel):
    rasgos: List[str] = Field(default_factory=list, max_length=6)
    paciencia: int = Field(3, ge=1, le=5)
    cordialidad: int = Field(3, ge=1, le=5)
    desconfianza: int = Field(3, ge=1, le=5)
    interes: int = Field(3, ge=1, le=5)
    habla: int = Field(3, ge=1, le=5)
    tecnologia: int = Field(3, ge=1, le=5)

    @field_validator("rasgos")
    @classmethod
    def _rasgos(cls, v: list[str]) -> list[str]:
        malos = [r for r in v if r not in ia.RASGOS]
        if malos:
            raise ValueError(f"Rasgo desconocido: {malos[0]}")
        return list(dict.fromkeys(v))


class CasoDatos(BaseModel):
    titulo: str = Field(min_length=2, max_length=120)
    cliente_nombre: str = Field(min_length=2, max_length=60)
    cliente_edad: Optional[int] = Field(None, ge=16, le=99)
    situacion: str = Field("", max_length=3000)
    objetivo: str = Field("", max_length=1500)
    actitud: Actitud = Field(default_factory=Actitud)
    objeciones: List[str] = Field(default_factory=list, max_length=12)
    info_correcta: List[str] = Field(default_factory=list, max_length=20)
    primer_mensaje: Optional[str] = Field(None, max_length=1000)
    detalles: Optional[str] = Field(None, max_length=2000)
    max_turnos: int = Field(14, ge=4, le=40)


def _aplicar_caso(c: CapCaso, d: CasoDatos) -> None:
    c.titulo, c.cliente_nombre, c.cliente_edad = d.titulo.strip(), d.cliente_nombre.strip(), d.cliente_edad
    c.situacion, c.objetivo = d.situacion.strip(), d.objetivo.strip()
    c.actitud = d.actitud.model_dump()
    c.objeciones, c.info_correcta = _lista(d.objeciones, 12, 300), _lista(d.info_correcta, 20, 400)
    c.primer_mensaje = (d.primer_mensaje or "").strip() or None
    c.detalles = (d.detalles or "").strip() or None
    c.max_turnos = d.max_turnos


@router.get("/entrenamientos")
async def listar(user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    """La biblioteca de entrenamientos con cuántos casos tienen y cómo les fue a los postulantes que el usuario ve."""
    _exigir_staff(user)
    ents = (await db.execute(select(CapEntrenamiento).order_by(CapEntrenamiento.estado, CapEntrenamiento.created_at.desc()))).scalars().all()
    casos: dict[str, int] = dict((await db.execute(select(CapCaso.entrenamiento_id, func.count()).group_by(CapCaso.entrenamiento_id))).all())
    visibles = {g.id for g in await srv.grupos_visibles(db, user)}
    # Por entrenamiento, cuántos postulantes lo recibieron, lo terminaron y salieron recomendados (con cualquier intento).
    personas: dict[str, dict[str, set[str]]] = {}
    for a in (await db.execute(select(CapAsignacion))).scalars().all():
        if a.grupo_id not in visibles:
            continue
        x = personas.setdefault(a.entrenamiento_id, {"enviados": set(), "terminados": set(), "aprobados": set()})
        x["enviados"].add(a.postulante_id)
        if a.estado == "terminado":
            x["terminados"].add(a.postulante_id)
        if (a.resultado or {}).get("aprobado"):
            x["aprobados"].add(a.postulante_id)
    stats = {eid: {k: len(v) for k, v in x.items()} for eid, x in personas.items()}
    quien = await srv.nombres(db, [e.created_by for e in ents])
    return {"entrenamientos": [{"id": e.id, "nombre": e.nombre, "estado": e.estado, "empresa": e.empresa, "casos": casos.get(e.id, 0),
                                "creado_por": quien.get(e.created_by, "—"), "updated_at": srv.iso(e.updated_at or e.created_at),
                                "puede_editar": puede_editar(user, e), **stats.get(e.id, {"enviados": 0, "terminados": 0, "aprobados": 0})}
                               for e in ents],
            "ia": {"disponible": ia.servicio_disponible(), "modelo": ia.settings.entrenamiento_modelo, "simulador": ia.simulador()},
            "meta": ia.settings.entrenamiento_meta_postulante,
            "rasgos": ia.RASGOS, "niveles": {k: {"nombre": n, "escala": esc} for k, (n, esc) in ia.NIVELES.items()},
            "criterios": ia.CRITERIOS}


@router.post("/entrenamientos", status_code=status.HTTP_201_CREATED)
async def crear(payload: EntrenamientoDatos, request: Request, user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    _exigir_staff(user)
    e = CapEntrenamiento(**payload.model_dump(), estado="borrador", created_by=user.id)
    e.nombre = e.nombre.strip()
    db.add(e)
    await db.commit()
    await record_action(db, user_id=user.id, action="capacitacion_entrenamiento_creado", resource_type="cap_entrenamiento",
                        resource_id=e.id, ip=client_ip(request), extra={"nombre": e.nombre})
    return await detalle(e.id, user, db)


@router.get("/entrenamientos/{eid}")
async def detalle(eid: str, user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    """El entrenamiento con sus casos y los postulantes a los que se envió (los de grupos que el usuario ve)."""
    e = await _entrenamiento(db, eid, user)
    casos = await _casos(db, e.id)
    quien = await srv.nombres(db, [e.created_by])
    visibles = {g.id: g for g in await srv.grupos_visibles(db, user)}
    asig = [a for a in (await db.execute(select(CapAsignacion).where(CapAsignacion.entrenamiento_id == e.id))).scalars().all()
            if a.grupo_id in visibles]
    ps = {p.id: p for p in (await db.execute(select(CapPostulante).where(CapPostulante.id.in_([a.postulante_id for a in asig] or [""])))).scalars().all()}
    progreso = await srv.entrenamientos_de(db, list(ps))
    filas = []
    for a in asig:
        p = ps.get(a.postulante_id)
        x = next((y for y in progreso.get(a.postulante_id, []) if y["id"] == a.id), None)
        if p and x:
            filas.append({**x, "postulante": {"id": p.id, "nombre": p.nombre, "apellido": p.apellido, "estado": p.estado},
                          "grupo": {"id": a.grupo_id, "nombre": visibles[a.grupo_id].nombre}, "resultado": a.resultado})
    filas.sort(key=lambda f: (f["grupo"]["nombre"], f["postulante"]["apellido"], f["postulante"]["id"], f["intento"]))
    return {**entrenamiento_dict(e, casos, user, quien), "asignaciones": filas}


@router.patch("/entrenamientos/{eid}")
async def editar(eid: str, payload: EntrenamientoEditar, request: Request, user: CurrentUser = Depends(require_ver),
                 db: AsyncSession = Depends(get_db)) -> dict:
    e = await _entrenamiento(db, eid, user, editar=True)
    cambios = payload.model_dump(exclude_unset=True, exclude_none=True)
    if cambios.get("estado") == "activo" and not await _casos(db, e.id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Agregá al menos un caso antes de activarlo")
    for k, v in cambios.items():
        setattr(e, k, v.strip() if isinstance(v, str) and k != "estado" else v)
    e.updated_at = srv.ahora()
    await db.commit()
    await record_action(db, user_id=user.id, action="capacitacion_entrenamiento_editado", resource_type="cap_entrenamiento",
                        resource_id=e.id, ip=client_ip(request), extra={"campos": sorted(cambios)})
    return await detalle(e.id, user, db)


@router.delete("/entrenamientos/{eid}")
async def borrar(eid: str, request: Request, user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    """Se borra si nunca se envió; si ya se envió, se archiva (los resultados quedan en las fichas)."""
    e = await _entrenamiento(db, eid, user, editar=True)
    enviado = (await db.execute(select(func.count()).select_from(CapAsignacion).where(CapAsignacion.entrenamiento_id == e.id))).scalar()
    if enviado:
        e.estado, e.updated_at = "archivado", srv.ahora()
    else:
        await db.execute(delete(CapSesion).where(CapSesion.caso_id.in_(select(CapCaso.id).where(CapCaso.entrenamiento_id == e.id))))
        await db.execute(delete(CapCaso).where(CapCaso.entrenamiento_id == e.id))
        await db.delete(e)
    await db.commit()
    await record_action(db, user_id=user.id, action="capacitacion_entrenamiento_borrado" if not enviado else "capacitacion_entrenamiento_archivado",
                        resource_type="cap_entrenamiento", resource_id=eid, ip=client_ip(request))
    return {"ok": True, "archivado": bool(enviado)}


@router.post("/entrenamientos/{eid}/casos", status_code=status.HTTP_201_CREATED)
async def crear_caso(eid: str, payload: CasoDatos, user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    e = await _entrenamiento(db, eid, user, editar=True)
    casos = await _casos(db, e.id)
    if len(casos) >= MAX_CASOS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Un entrenamiento puede tener hasta {MAX_CASOS} casos")
    c = CapCaso(entrenamiento_id=e.id, orden=(max((x.orden for x in casos), default=0) + 1))
    _aplicar_caso(c, payload)
    db.add(c)
    e.updated_at = srv.ahora()
    await db.commit()
    return caso_dict(c)


async def _caso(db: AsyncSession, cid: str, user: CurrentUser, *, editar: bool) -> tuple[CapCaso, CapEntrenamiento]:
    c = await db.get(CapCaso, cid)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Caso no encontrado")
    return c, await _entrenamiento(db, c.entrenamiento_id, user, editar=editar)


@router.patch("/casos/{cid}")
async def editar_caso(cid: str, payload: CasoDatos, user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    c, e = await _caso(db, cid, user, editar=True)
    _aplicar_caso(c, payload)
    c.updated_at = e.updated_at = srv.ahora()
    await db.commit()
    return caso_dict(c)


@router.delete("/casos/{cid}")
async def borrar_caso(cid: str, user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    c, e = await _caso(db, cid, user, editar=True)
    usado = (await db.execute(select(func.count()).select_from(CapSesion).where(CapSesion.caso_id == c.id,
                                                                                CapSesion.asignacion_id.isnot(None)))).scalar()
    if usado:
        raise HTTPException(status.HTTP_409_CONFLICT, "Algún postulante ya hizo este caso: no se puede borrar (podés editarlo)")
    await db.execute(delete(CapSesion).where(CapSesion.caso_id == c.id))
    await db.delete(c)
    e.updated_at = srv.ahora()
    await db.commit()
    return {"ok": True}


class Orden(BaseModel):
    ids: List[str] = Field(max_length=MAX_CASOS)


@router.post("/entrenamientos/{eid}/orden")
async def ordenar(eid: str, payload: Orden, user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    e = await _entrenamiento(db, eid, user, editar=True)
    casos = {c.id: c for c in await _casos(db, e.id)}
    if set(payload.ids) != set(casos):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El orden tiene que incluir todos los casos")
    for i, cid in enumerate(payload.ids, start=1):
        casos[cid].orden = i
    await db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ enviar a postulantes
class Envio(BaseModel):
    postulante_ids: List[str] = Field(min_length=1, max_length=200)
    origen: str = Field(..., max_length=200)
    # A quien ya lo terminó se lo manda de nuevo como otro intento (el anterior queda con su resultado).
    repetir: bool = False


async def ultimo_intento(db: AsyncSession, eid: str, pid: str) -> Optional[CapAsignacion]:
    return (await db.execute(select(CapAsignacion).where(CapAsignacion.entrenamiento_id == eid, CapAsignacion.postulante_id == pid)
                             .order_by(CapAsignacion.intento.desc()))).scalars().first()


async def asegurar_link(db: AsyncSession, p: CapPostulante, origen: str, user_id: str) -> tuple[str, bool]:
    """El link vigente del postulante (o uno nuevo si no tenía o venció; lo respondido se conserva)."""
    e = (await db.execute(select(CapEnlace).where(CapEnlace.postulante_id == p.id))).scalar_one_or_none()
    if e and e.activo and srv.utc(e.vence_at) > srv.ahora():
        token = seg.descifrar(e.token_enc)
        if token:
            return f"{e.origen}/postulante/{token}", False
    token = secrets.token_urlsafe(32)
    if e is None:
        e = CapEnlace(postulante_id=p.id, respuestas={}, ipv_estado="pendiente", created_by=user_id)
        db.add(e)
    e.token_hash, e.token_enc, e.origen, e.activo = _hash(token), seg.cifrar(token), origen, True
    e.vence_at = srv.ahora() + timedelta(days=DIAS_LINK)
    srv.evento(db, grupo_id=p.grupo_id, postulante_id=p.id, tipo="link", por=user_id, nuevo=True)
    return f"{origen}/postulante/{token}", True


@router.post("/entrenamientos/{eid}/enviar")
async def enviar(eid: str, payload: Envio, request: Request, user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    """Envía el entrenamiento a los postulantes elegidos: lo ven en su link. Devuelve cada link para mandarlo."""
    e = await _entrenamiento(db, eid, user)
    if e.estado == "archivado":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El entrenamiento está archivado")
    if not await _casos(db, e.id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El entrenamiento no tiene casos")
    origen = _origen(payload.origen)
    salida = []
    for pid in dict.fromkeys(payload.postulante_ids):
        p = await db.get(CapPostulante, pid)
        g = await db.get(CapGrupo, p.grupo_id) if p else None
        if not p or not g or not srv.roles_en(g, user):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Postulante no encontrado")
        if g.estado == "cancelada" or p.estado in srv.SALIDAS:
            salida.append({"postulante_id": p.id, "nombre": p.nombre, "apellido": p.apellido, "url": None, "omitido": "no está activo"})
            continue
        ult = await ultimo_intento(db, e.id, p.id)
        intento = 1 if ult is None else (ult.intento or 1) + 1 if payload.repetir and ult.estado == "terminado" else None
        if intento:
            db.add(CapAsignacion(entrenamiento_id=e.id, postulante_id=p.id, grupo_id=g.id, estado="pendiente",
                                 asignado_por=user.id, asignado_at=srv.ahora(), intento=intento))
            srv.evento(db, grupo_id=g.id, postulante_id=p.id, tipo="entrenamiento_enviado", por=user.id,
                       entrenamiento=e.nombre if intento == 1 else f"{e.nombre} (intento {intento})")
        url, nuevo = await asegurar_link(db, p, origen, user.id)
        salida.append({"postulante_id": p.id, "nombre": p.nombre, "apellido": p.apellido, "url": url, "nuevo_link": nuevo,
                       "ya_enviado": intento is None, "intento": intento or (ult.intento or 1 if ult else 1)})
    if e.estado == "borrador":
        e.estado = "activo"
    await db.commit()
    await record_action(db, user_id=user.id, action="capacitacion_entrenamiento_enviado", resource_type="cap_entrenamiento",
                        resource_id=e.id, ip=client_ip(request), extra={"postulantes": len(salida)})
    return {"entrenamiento": e.nombre, "enviados": salida}


async def _asignacion(db: AsyncSession, aid: str, user: CurrentUser) -> tuple[CapAsignacion, set[str]]:
    _exigir_staff(user)
    a = await db.get(CapAsignacion, aid)
    g = await db.get(CapGrupo, a.grupo_id) if a else None
    roles = srv.roles_en(g, user) if g else set()
    if not a or not roles:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Envío no encontrado")
    return a, roles


@router.delete("/asignaciones/{aid}")
async def quitar(aid: str, request: Request, user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    a, _ = await _asignacion(db, aid, user)
    empezado = (await db.execute(select(func.count()).select_from(CapSesion).where(CapSesion.asignacion_id == a.id))).scalar()
    if empezado:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya empezó el entrenamiento: podés reiniciarlo, no quitarlo")
    await db.delete(a)
    await db.commit()
    await record_action(db, user_id=user.id, action="capacitacion_entrenamiento_quitado", resource_type="cap_asignacion",
                        resource_id=aid, ip=client_ip(request))
    return {"ok": True}


@router.post("/asignaciones/{aid}/reiniciar")
async def reiniciar(aid: str, request: Request, user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    """Borra lo hecho para que lo vuelva a hacer (por ejemplo, si se cortó o falló la IA). Queda en la auditoría."""
    a, roles = await _asignacion(db, aid, user)
    if not ({"capacitador", "gestion"} & roles):
        e = await db.get(CapEntrenamiento, a.entrenamiento_id)
        if e.created_by != user.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Lo reinicia el capacitador, la gestión o quien creó el entrenamiento")
    await db.execute(delete(CapSesion).where(CapSesion.asignacion_id == a.id))
    a.estado, a.resultado, a.iniciado_at, a.terminado_at, a.intentos_eval = "pendiente", None, None, None, 0
    srv.evento(db, grupo_id=a.grupo_id, postulante_id=a.postulante_id, tipo="entrenamiento_reiniciado", por=user.id)
    await db.commit()
    await record_action(db, user_id=user.id, action="capacitacion_entrenamiento_reiniciado", resource_type="cap_asignacion",
                        resource_id=aid, ip=client_ip(request))
    return {"ok": True}


# ------------------------------------------------------------------ resultados en la ficha
@router.get("/postulantes/{pid}/entrenamientos")
async def de_postulante(pid: str, user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    """Los entrenamientos del postulante: avance, resultado final y cada caso con su evaluación."""
    p = await db.get(CapPostulante, pid)
    g = await db.get(CapGrupo, p.grupo_id) if p else None
    if not p or not g or not srv.roles_en(g, user):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Postulante no encontrado")
    progreso = (await srv.entrenamientos_de(db, [p.id])).get(p.id, [])
    salida = []
    for x in progreso:
        a = await db.get(CapAsignacion, x["id"])
        casos = await _casos(db, x["entrenamiento_id"])
        sesiones = (await db.execute(select(CapSesion).where(CapSesion.asignacion_id == a.id).order_by(CapSesion.iniciado_at))).scalars().all()
        por_caso = {s.caso_id: s for s in sesiones}
        salida.append({**x, "resultado": a.resultado, "casos_detalle": [
            {"caso_id": c.id, "orden": i + 1, "titulo": c.titulo, "cliente": c.cliente_nombre,
             "sesion": ({"id": s.id, "estado": s.estado, "segundos": s.segundos, "turnos": ia.turnos(s.mensajes or []),
                         "info_correcta": (s.evaluacion or {}).get("info_correcta"), "nivel": (s.evaluacion or {}).get("nivel"),
                         "resumen": (s.evaluacion or {}).get("resumen"), "error": s.error}
                        if (s := por_caso.get(c.id)) else None)}
            for i, c in enumerate(casos)]})
    return {"entrenamientos": salida}


async def _sesion_staff(db: AsyncSession, sid: str, user: CurrentUser) -> CapSesion:
    _exigir_staff(user)
    s = await db.get(CapSesion, sid)
    if s and s.prueba_por:
        if s.prueba_por != user.id:
            s = None
    elif s and s.postulante_id:
        p = await db.get(CapPostulante, s.postulante_id)
        g = await db.get(CapGrupo, p.grupo_id) if p else None
        if not g or not srv.roles_en(g, user):
            s = None
    if not s:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")
    return s


@router.get("/sesiones/{sid}")
async def ver_sesion(sid: str, user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    """La conversación completa con su evaluación (para el equipo)."""
    return sesion_staff(await _sesion_staff(db, sid, user))


# ------------------------------------------------------------------ probar un caso (el mentor hace de asesor)
@router.post("/casos/{cid}/probar", status_code=status.HTTP_201_CREATED)
async def probar(cid: str, user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    c, e = await _caso(db, cid, user, editar=False)
    s = await abrir(db, e=e, c=c, prueba_por=user.id)
    await db.commit()
    return sesion_staff(s)


class Mensaje(BaseModel):
    """Uno o varios mensajes seguidos del asesor. `lote` es una marca del navegador para no duplicar un reenvío."""
    texto: Optional[str] = Field(None, max_length=MAX_TEXTO)
    textos: Optional[List[str]] = Field(None, min_length=1, max_length=MAX_LOTE)
    lote: Optional[str] = Field(None, min_length=8, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")

    def lista(self) -> list[str]:
        return list(self.textos) if self.textos else [self.texto or ""]


@router.post("/sesiones/{sid}/mensajes")
async def probar_mensaje(sid: str, payload: Mensaje, user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    s = await _sesion_staff(db, sid, user)
    if not s.prueba_por:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo en una prueba")
    async with candado(s.id):
        await db.refresh(s)
        r = await turno(db, s, payload.lista(), payload.lote)
        await db.commit()
    return {**r, "sesion": sesion_staff(s)}


@router.post("/sesiones/{sid}/terminar")
async def probar_terminar(sid: str, user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    """Cierra la prueba y la evalúa en el momento, para ver cómo califica la IA."""
    s = await _sesion_staff(db, sid, user)
    if not s.prueba_por:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo en una prueba")
    if s.estado == "en_curso":
        cerrar(s, "asesor")
    if s.estado == "evaluando":
        try:
            await evaluar_sesion(s)
        except Exception as exc:  # noqa: BLE001
            await db.commit()
            raise _error_ia(exc) from exc
    await db.commit()
    return sesion_staff(s)
