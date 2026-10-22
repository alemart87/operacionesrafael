"""Capacitación y Mentoría — API para el equipo (capacitador, mentor y la vista completa).

- Grupos: crear, editar (nombre, operación, fin previsto, mentores; el capacitador lo cambia la gestión) y su estado
  (en curso, finalizada, cancelada). Duración y efectividad (altas operativas sobre ingresados) de cada uno.
- Postulantes: alta (nombre, apellido, CI, edad, sexo), corrección de datos, estados según el papel (ver
  `servicio.destinos`).
- Link seguro del postulante: el token (256 bits) se guarda por su huella y cifrado para volver a mostrarlo con su QR;
  regenerarlo invalida el anterior y conserva lo respondido. Vence a los `DIAS_LINK` días.
- Seguimiento: comentarios de feedback u oportunidad de mejora, escritos o dictados, y el conteo por postulante.
- Ficha del postulante (IPV corregido, historial y comentarios) y estadísticas por sexo y edad, generales y por
  grupo.

Cada alta, cambio de estado y link queda en el historial del grupo y en la auditoría.
"""
from __future__ import annotations

import hashlib
import re
import secrets
from datetime import date, timedelta
from typing import Any, List, Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...api.deps import CurrentUser, client_ip, require_perm
from ...core.config import settings
from ...core.database import get_db
from ...services import seguridad as seg
from ...services.audit_service import record_action
from . import audios as audios_srv
from . import ipv
from . import servicio as srv
from .models import CapAudio, CapComentario, CapEnlace, CapEvento, CapGrupo, CapPostulante

router = APIRouter(prefix="/capacitacion", tags=["capacitación y mentoría"])
require_ver = require_perm(srv.PERM_VER)

DIAS_LINK = 21
# Tipos del historial de funciones que se sacaron (pruebas en papel): quedan en la base y en la auditoría, pero no se muestran.
EVENTOS_RETIRADOS = {"pruebas"}
_ORIGEN = re.compile(r"^https?://[A-Za-z0-9.-]+(:\d{1,5})?$")
_CI = re.compile(r"^[0-9A-Za-z.\-]{3,20}$")


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _nombre(v: str) -> str:
    v = re.sub(r"\s+", " ", (v or "").strip())
    if len(v) < 2:
        raise ValueError("Tiene que tener al menos 2 letras")
    return v


# ------------------------------------------------------------------ carga con permiso
async def _grupo(db: AsyncSession, grupo_id: str, user: CurrentUser) -> tuple[CapGrupo, set[str]]:
    g = await db.get(CapGrupo, grupo_id)
    roles = srv.roles_en(g, user) if g else set()
    if not g or not roles:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Grupo no encontrado")
    return g, roles


async def _postulante(db: AsyncSession, pid: str, user: CurrentUser) -> tuple[CapPostulante, CapGrupo, set[str]]:
    p = await db.get(CapPostulante, pid)
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Postulante no encontrado")
    g, roles = await _grupo(db, p.grupo_id, user)
    return p, g, roles


def _exigir(roles: set[str], *permitidos: str, mensaje: str = "No podés hacer esto en este grupo") -> None:
    if not (roles & set(permitidos)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, mensaje)


# ------------------------------------------------------------------ tablero
@router.get("/resumen")
async def resumen(estado: Optional[Literal["en_curso", "finalizada", "cancelada"]] = None,
                  desde: Optional[date] = None, hasta: Optional[date] = None,
                  user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    """Los grupos que ve el usuario (con su embudo, efectividad, duración e IPV) y los totales: estados de los
    postulantes, IPV, feedback y estadísticas por sexo y edad. Filtros: estado del grupo y rango de inicio."""
    grupos = [g for g in await srv.grupos_visibles(db, user)
              if (not estado or g.estado == estado) and (not desde or g.fecha_inicio >= desde) and (not hasta or g.fecha_inicio <= hasta)]
    d = await srv.cargar(db, [g.id for g in grupos])
    quien = await srv.nombres(db, [g.capacitador_id for g in grupos] + [m for g in grupos for m in (g.mentores or [])])
    todos = d.todos()
    filas = [srv.grupo_dict(g, d.postulantes[g.id], d, user, quien) for g in grupos]
    cerrados = [g for g in grupos if g.estado == "finalizada"]
    return {
        "grupos": filas,
        "totales": {
            "grupos": len(grupos), "en_curso": sum(1 for g in grupos if g.estado == "en_curso"),
            "finalizados": len(cerrados), "cancelados": sum(1 for g in grupos if g.estado == "cancelada"),
            "duracion_promedio": round(sum(srv.duracion_dias(g) for g in cerrados) / len(cerrados), 1) if cerrados else None,
            "embudo": srv.embudo(todos), "ipv": srv.resumen_ipv(todos, d), "feedback": srv.feedback_total(todos, d),
        },
        "estadisticas": srv.estadisticas(todos, d),
        "puede": {"crear": user.is_superadmin or user.has_perm(srv.PERM_CAPACITAR) or user.has_perm(srv.PERM_TOTAL),
                  "gestion": srv.es_gestion(user)},
        "estados": srv.ESTADO_NOMBRE, "estados_grupo": srv.GRUPO_NOMBRE,
    }


@router.get("/personas")
async def personas(user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    """Capacitadores y mentores habilitados, para elegirlos en un grupo."""
    if not (srv.es_gestion(user) or user.has_perm(srv.PERM_CAPACITAR)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No podés armar grupos")
    return await srv.personas(db)


# ------------------------------------------------------------------ grupos
class GrupoCrear(BaseModel):
    nombre: str = Field(min_length=2, max_length=120)
    operacion: Optional[str] = Field(None, max_length=120)
    fecha_inicio: date
    fin_previsto: Optional[date] = None
    capacitador_id: Optional[str] = Field(None, max_length=36)
    mentores: List[str] = Field(default_factory=list, max_length=10)

    _n = field_validator("nombre")(lambda cls, v: _nombre(v))


class GrupoEditar(BaseModel):
    nombre: Optional[str] = Field(None, min_length=2, max_length=120)
    operacion: Optional[str] = Field(None, max_length=120)
    fecha_inicio: Optional[date] = None
    fin_previsto: Optional[date] = None
    capacitador_id: Optional[str] = Field(None, max_length=36)
    mentores: Optional[List[str]] = Field(None, max_length=10)


def _fechas(inicio: date, fin_previsto: Optional[date]) -> None:
    if fin_previsto and fin_previsto < inicio:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El fin previsto no puede ser antes del inicio")
    if abs((inicio - srv.hoy()).days) > 400:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Revisá la fecha de inicio")


async def _validar_equipo(db: AsyncSession, capacitador_id: str, mentores: list[str]) -> list[str]:
    gente = await srv.personas(db)
    if capacitador_id not in {x["id"] for x in gente["capacitadores"]}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El capacitador elegido no está habilitado")
    validos = {x["id"] for x in gente["mentores"]}
    limpios = list(dict.fromkeys(mentores))
    if any(m not in validos for m in limpios):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Algún mentor elegido no está habilitado")
    return limpios


@router.post("/grupos", status_code=status.HTTP_201_CREATED)
async def crear_grupo(payload: GrupoCrear, request: Request, user: CurrentUser = Depends(require_ver),
                      db: AsyncSession = Depends(get_db)) -> dict:
    gestion = srv.es_gestion(user)
    if not (gestion or user.has_perm(srv.PERM_CAPACITAR)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No podés crear grupos")
    capacitador = payload.capacitador_id if gestion and payload.capacitador_id else user.id
    if capacitador == user.id and not user.has_perm(srv.PERM_CAPACITAR):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Elegí quién es el capacitador del grupo")
    _fechas(payload.fecha_inicio, payload.fin_previsto)
    mentores = await _validar_equipo(db, capacitador, payload.mentores)
    g = CapGrupo(nombre=payload.nombre, operacion=(payload.operacion or "").strip() or None, capacitador_id=capacitador,
                 mentores=mentores, estado="en_curso", fecha_inicio=payload.fecha_inicio, fin_previsto=payload.fin_previsto,
                 created_by=user.id)
    db.add(g)
    await db.flush()
    srv.evento(db, grupo_id=g.id, tipo="grupo_creado", por=user.id, a="en_curso")
    await db.commit()
    await record_action(db, user_id=user.id, action="capacitacion_grupo_creado", resource_type="cap_grupo", resource_id=g.id,
                        ip=client_ip(request), extra={"nombre": g.nombre, "capacitador": capacitador, "mentores": mentores})
    return await detalle_grupo(g.id, user, db)


@router.patch("/grupos/{grupo_id}")
async def editar_grupo(grupo_id: str, payload: GrupoEditar, request: Request, user: CurrentUser = Depends(require_ver),
                       db: AsyncSession = Depends(get_db)) -> dict:
    g, roles = await _grupo(db, grupo_id, user)
    _exigir(roles, "capacitador", "gestion")
    cambios = payload.model_dump(exclude_unset=True)
    if "capacitador_id" in cambios and cambios["capacitador_id"] != g.capacitador_id and "gestion" not in roles:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "El capacitador del grupo lo cambia la gestión")
    if "nombre" in cambios and cambios["nombre"] is not None:
        g.nombre = _nombre(cambios["nombre"])
    if "operacion" in cambios:
        g.operacion = (cambios["operacion"] or "").strip() or None
    if "fecha_inicio" in cambios and cambios["fecha_inicio"]:
        g.fecha_inicio = cambios["fecha_inicio"]
    if "fin_previsto" in cambios:
        g.fin_previsto = cambios["fin_previsto"]
    _fechas(g.fecha_inicio, g.fin_previsto)
    if "capacitador_id" in cambios or "mentores" in cambios:
        capacitador = cambios.get("capacitador_id") or g.capacitador_id
        g.mentores = await _validar_equipo(db, capacitador, cambios.get("mentores") if cambios.get("mentores") is not None else list(g.mentores or []))
        g.capacitador_id = capacitador
    g.updated_at = srv.ahora()
    srv.evento(db, grupo_id=g.id, tipo="grupo_editado", por=user.id, campos=sorted(cambios))
    await db.commit()
    await record_action(db, user_id=user.id, action="capacitacion_grupo_editado", resource_type="cap_grupo", resource_id=g.id,
                        ip=client_ip(request), extra={"campos": sorted(cambios)})
    return await detalle_grupo(g.id, user, db)


class EstadoGrupo(BaseModel):
    estado: Literal["en_curso", "finalizada", "cancelada"]
    motivo: Optional[str] = Field(None, max_length=500)


@router.post("/grupos/{grupo_id}/estado")
async def estado_grupo(grupo_id: str, payload: EstadoGrupo, request: Request, user: CurrentUser = Depends(require_ver),
                       db: AsyncSession = Depends(get_db)) -> dict:
    g, roles = await _grupo(db, grupo_id, user)
    if payload.estado not in srv.destinos_grupo(g, roles):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ese cambio de estado no está permitido")
    motivo = (payload.motivo or "").strip()
    if payload.estado == "cancelada" and len(motivo) < 3:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Contá por qué se cancela")
    antes = g.estado
    g.estado = payload.estado
    g.fecha_fin = None if payload.estado == "en_curso" else srv.hoy()
    g.motivo = (motivo or None) if payload.estado == "cancelada" else None
    g.updated_at = srv.ahora()
    srv.evento(db, grupo_id=g.id, tipo="grupo_estado", por=user.id, de=antes, a=g.estado, motivo=motivo or None)
    await db.commit()
    await record_action(db, user_id=user.id, action="capacitacion_grupo_estado", resource_type="cap_grupo", resource_id=g.id,
                        ip=client_ip(request), extra={"de": antes, "a": g.estado})
    return await detalle_grupo(g.id, user, db)


@router.get("/grupos/{grupo_id}")
async def detalle_grupo(grupo_id: str, user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    """El grupo con sus postulantes (estado, IPV, feedback y lo que el usuario puede hacer con cada uno), el embudo, el IPV
    del grupo, el feedback y las estadísticas por sexo y edad."""
    g, roles = await _grupo(db, grupo_id, user)
    d = await srv.cargar(db, [g.id])
    ps = d.postulantes[g.id]
    quien = await srv.nombres(db, [g.capacitador_id, *(g.mentores or [])])
    eventos = (await db.execute(select(CapEvento).where(CapEvento.grupo_id == g.id, CapEvento.postulante_id.is_(None))
                                .order_by(CapEvento.at.desc()).limit(30))).scalars().all()
    quien.update(await srv.nombres(db, [e.por for e in eventos]))
    return {
        **srv.grupo_dict(g, ps, d, user, quien),
        "postulantes": [srv.postulante_fila(p, d, g, roles) for p in ps],
        "ipv_detalle": srv.resumen_ipv(ps, d), "feedback_detalle": srv.feedback_total(ps, d),
        "estadisticas": srv.estadisticas(ps, d),
        "historial": [{"tipo": e.tipo, "de": e.de, "a": e.a, "at": srv.iso(e.at), "por": quien.get(e.por or "", None),
                       "motivo": (e.datos or {}).get("motivo")} for e in eventos],
    }


# ------------------------------------------------------------------ postulantes
class PostulanteDatos(BaseModel):
    nombre: str = Field(min_length=2, max_length=80)
    apellido: str = Field(min_length=2, max_length=80)
    ci: str = Field(min_length=3, max_length=20)
    edad: int = Field(ge=15, le=80)
    sexo: Literal["F", "M", "X"]

    _n = field_validator("nombre", "apellido")(lambda cls, v: _nombre(v))

    @field_validator("ci")
    @classmethod
    def _ci(cls, v: str) -> str:
        v = re.sub(r"\s+", "", v or "")
        if not _CI.match(v):
            raise ValueError("La cédula solo lleva números (y puntos o guion)")
        return v


class PostulanteEditar(BaseModel):
    nombre: Optional[str] = Field(None, min_length=2, max_length=80)
    apellido: Optional[str] = Field(None, min_length=2, max_length=80)
    ci: Optional[str] = Field(None, min_length=3, max_length=20)
    edad: Optional[int] = Field(None, ge=15, le=80)
    sexo: Optional[Literal["F", "M", "X"]] = None


def _ci_norm(ci: str) -> str:
    return re.sub(r"[^0-9A-Za-z]", "", ci).upper()


async def _ci_libre(db: AsyncSession, grupo_id: str, ci: str, excepto: Optional[str] = None) -> None:
    filas = (await db.execute(select(CapPostulante.id, CapPostulante.ci).where(CapPostulante.grupo_id == grupo_id))).all()
    if any(_ci_norm(c) == _ci_norm(ci) and i != excepto for i, c in filas):
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya hay un postulante con esa cédula en el grupo")


@router.post("/grupos/{grupo_id}/postulantes", status_code=status.HTTP_201_CREATED)
async def crear_postulante(grupo_id: str, payload: PostulanteDatos, request: Request, user: CurrentUser = Depends(require_ver),
                           db: AsyncSession = Depends(get_db)) -> dict:
    g, roles = await _grupo(db, grupo_id, user)
    _exigir(roles, "capacitador", "gestion", mensaje="Los postulantes los carga el capacitador")
    if g.estado != "en_curso":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El grupo no está en curso")
    await _ci_libre(db, g.id, payload.ci)
    p = CapPostulante(grupo_id=g.id, nombre=payload.nombre, apellido=payload.apellido, ci=payload.ci, edad=payload.edad,
                      sexo=payload.sexo, estado="en_capacitacion", etapa_max=0, estado_at=srv.ahora(), estado_por=user.id,
                      pruebas={}, created_by=user.id)
    db.add(p)
    await db.flush()
    srv.evento(db, grupo_id=g.id, postulante_id=p.id, tipo="alta", por=user.id, a="en_capacitacion")
    await db.commit()
    await record_action(db, user_id=user.id, action="capacitacion_postulante_alta", resource_type="cap_postulante",
                        resource_id=p.id, ip=client_ip(request), extra={"grupo": g.id})
    d = await srv.cargar(db, [g.id])
    return srv.postulante_fila(p, d, g, roles)


@router.patch("/postulantes/{pid}")
async def editar_postulante(pid: str, payload: PostulanteEditar, request: Request, user: CurrentUser = Depends(require_ver),
                            db: AsyncSession = Depends(get_db)) -> dict:
    p, g, roles = await _postulante(db, pid, user)
    _exigir(roles, "capacitador", "gestion", mensaje="Los datos los corrige el capacitador")
    cambios = payload.model_dump(exclude_unset=True, exclude_none=True)
    try:
        datos = PostulanteDatos(**{**{k: getattr(p, k) for k in ("nombre", "apellido", "ci", "edad", "sexo")}, **cambios})
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Revisá los datos del postulante") from exc
    if datos.ci != p.ci:
        await _ci_libre(db, g.id, datos.ci, excepto=p.id)
    for k in ("nombre", "apellido", "ci", "edad", "sexo"):
        setattr(p, k, getattr(datos, k))
    p.updated_at = srv.ahora()
    srv.evento(db, grupo_id=g.id, postulante_id=p.id, tipo="datos", por=user.id, campos=sorted(cambios))
    await db.commit()
    await record_action(db, user_id=user.id, action="capacitacion_postulante_datos", resource_type="cap_postulante",
                        resource_id=p.id, ip=client_ip(request), extra={"campos": sorted(cambios)})
    d = await srv.cargar(db, [g.id])
    return srv.postulante_fila(p, d, g, roles)


@router.delete("/postulantes/{pid}")
async def borrar_postulante(pid: str, request: Request, user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    """Solo para corregir una carga por error: sin IPV empezado ni comentarios. Si ya participó, se le cambia el estado."""
    p, g, roles = await _postulante(db, pid, user)
    _exigir(roles, "capacitador", "gestion")
    e = (await db.execute(select(CapEnlace).where(CapEnlace.postulante_id == p.id))).scalar_one_or_none()
    hay = (await db.execute(select(CapComentario.id).where(CapComentario.postulante_id == p.id).limit(1))).first()
    if (e and e.ipv_estado != "pendiente") or hay:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya tiene IPV o comentarios: marcá su baja en lugar de borrarlo")
    if e:
        await db.delete(e)
    await db.execute(delete(CapEvento).where(CapEvento.postulante_id == p.id))
    await db.delete(p)
    srv.evento(db, grupo_id=g.id, tipo="postulante_borrado", por=user.id, nombre=f"{p.nombre} {p.apellido}")
    await db.commit()
    await record_action(db, user_id=user.id, action="capacitacion_postulante_borrado", resource_type="cap_postulante",
                        resource_id=pid, ip=client_ip(request), extra={"grupo": g.id})
    return {"ok": True}


class EstadoPostulante(BaseModel):
    estado: Literal["en_capacitacion", "aprobo_escrita", "aprobo_mentoria", "alta_operativa", "abandono", "baja"]
    motivo: Optional[str] = Field(None, max_length=500)


@router.post("/postulantes/{pid}/estado")
async def estado_postulante(pid: str, payload: EstadoPostulante, request: Request, user: CurrentUser = Depends(require_ver),
                            db: AsyncSession = Depends(get_db)) -> dict:
    p, g, roles = await _postulante(db, pid, user)
    if payload.estado not in srv.destinos(p, roles, g):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Ese estado no lo podés cargar vos (o no corresponde ahora)")
    motivo = (payload.motivo or "").strip()
    if payload.estado in srv.SALIDAS and len(motivo) < 3:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Contá el motivo")
    antes = p.estado
    srv.aplicar_estado(p, payload.estado, motivo or None, user.id)
    p.updated_at = srv.ahora()
    srv.evento(db, grupo_id=g.id, postulante_id=p.id, tipo="estado", por=user.id, de=antes, a=p.estado,
               motivo=motivo or None, rol=srv.rol_principal(roles))
    await db.commit()
    await record_action(db, user_id=user.id, action="capacitacion_postulante_estado", resource_type="cap_postulante",
                        resource_id=p.id, ip=client_ip(request), extra={"de": antes, "a": p.estado})
    d = await srv.cargar(db, [g.id])
    return srv.postulante_fila(p, d, g, roles)


# ------------------------------------------------------------------ ficha del postulante
def _comentario_dict(c: CapComentario, quien: dict[str, str], audios: dict[str, CapAudio]) -> dict[str, Any]:
    a = audios.get(c.audio_id or "")
    return {"id": c.id, "tipo": c.tipo, "autor_rol": c.autor_rol, "autor": quien.get(c.autor_id or "", None) if c.autor_id else None,
            "texto": c.texto, "at": srv.iso(c.created_at), "audio": audios_srv.a_dict(a) if a else None}


@router.get("/postulantes/{pid}")
async def ficha(pid: str, user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    """La ficha del postulante: datos, estado y lo que se puede cargar, IPV corregido con la descripción de cada escala,
    comentarios de seguimiento (con sus audios) y el historial."""
    p, g, roles = await _postulante(db, pid, user)
    d = await srv.cargar(db, [g.id])
    e = d.enlaces.get(p.id)
    comentarios = (await db.execute(select(CapComentario).where(CapComentario.postulante_id == p.id)
                                    .order_by(CapComentario.created_at.desc()))).scalars().all()
    eventos = (await db.execute(select(CapEvento).where(CapEvento.postulante_id == p.id).order_by(CapEvento.at.desc()))).scalars().all()
    ids_audio = [c.audio_id for c in comentarios if c.audio_id]
    audios = {a.id: a for a in (await db.execute(select(CapAudio).where(CapAudio.id.in_(ids_audio)))).scalars().all()} if ids_audio else {}
    quien = await srv.nombres(db, [c.autor_id for c in comentarios] + [x.por for x in eventos] + [g.capacitador_id])
    resultado = e.resultado if e and e.ipv_estado == "terminado" else None
    return {
        "postulante": srv.postulante_fila(p, d, g, roles),
        "grupo": {"id": g.id, "nombre": g.nombre, "estado": g.estado, "fecha_inicio": srv.iso(g.fecha_inicio),
                  "capacitador": quien.get(g.capacitador_id, "—"), "dia": srv.duracion_dias(g)},
        "roles": sorted(roles), "rol": srv.rol_principal(roles),
        "puede": {"datos": bool({"capacitador", "gestion"} & roles), "link": bool({"capacitador", "gestion"} & roles) and g.estado != "cancelada",
                  "comentar": g.estado != "cancelada"},
        "ipv": {**srv.ipv_de(e), "resultado": resultado, "iniciado_at": srv.iso(e.iniciado_at) if e else None,
                "vence_at": srv.iso(e.vence_at) if e else None, "dispositivo": e.dispositivo if e else None},
        "escalas": ipv.ESCALAS, "niveles_ipv": ipv.NIVELES_IPV,
        "comentarios": [_comentario_dict(c, quien, audios) for c in comentarios],
        "conteo": srv.conteo(d.comentarios[p.id]),
        "historial": [{"tipo": x.tipo, "de": x.de, "a": x.a, "at": srv.iso(x.at), "por": quien.get(x.por or "", None),
                       "motivo": (x.datos or {}).get("motivo"), "detalle": (x.datos or {}).get("entrenamiento")}
                      for x in eventos if x.tipo not in EVENTOS_RETIRADOS],
    }


# ------------------------------------------------------------------ link seguro del postulante
class EnlacePedido(BaseModel):
    origen: str = Field(..., max_length=200)


def _origen(v: str) -> str:
    v = (v or "").strip().rstrip("/")
    if not _ORIGEN.match(v):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Dirección de la plataforma inválida")
    return v


def _enlace_dict(e: CapEnlace, token: Optional[str]) -> dict[str, Any]:
    vigente = e.activo and srv.utc(e.vence_at) > srv.ahora()
    out: dict[str, Any] = {"activo": vigente, "vence_at": srv.iso(e.vence_at), "ipv_estado": e.ipv_estado,
                           "respondidas": len(e.respuestas or {}), "total": ipv.TOTAL, "url": None, "qr_svg": None}
    if vigente and token:
        out["url"] = f"{e.origen}/postulante/{token}"
        out["qr_svg"] = seg.qr_svg(out["url"])
    return out


@router.post("/postulantes/{pid}/enlace")
async def generar_enlace(pid: str, payload: EnlacePedido, request: Request, user: CurrentUser = Depends(require_ver),
                         db: AsyncSession = Depends(get_db)) -> dict:
    """Genera (o regenera) el link del postulante: el anterior deja de valer; lo respondido se conserva."""
    p, g, roles = await _postulante(db, pid, user)
    _exigir(roles, "capacitador", "gestion", mensaje="El link lo genera el capacitador")
    if g.estado == "cancelada" or p.estado in srv.SALIDAS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El postulante no está activo")
    origen = _origen(payload.origen)
    token = secrets.token_urlsafe(32)
    e = (await db.execute(select(CapEnlace).where(CapEnlace.postulante_id == p.id))).scalar_one_or_none()
    nuevo = e is None
    if nuevo:
        e = CapEnlace(postulante_id=p.id, respuestas={}, ipv_estado="pendiente", created_by=user.id)
        db.add(e)
    e.token_hash, e.token_enc, e.origen, e.activo = _hash(token), seg.cifrar(token), origen, True
    e.vence_at = srv.ahora() + timedelta(days=DIAS_LINK)
    srv.evento(db, grupo_id=g.id, postulante_id=p.id, tipo="link", por=user.id, nuevo=nuevo)
    await db.commit()
    await record_action(db, user_id=user.id, action="capacitacion_link", resource_type="cap_postulante", resource_id=p.id,
                        ip=client_ip(request), extra={"nuevo": nuevo, "vence": srv.iso(e.vence_at)})
    return _enlace_dict(e, token)


@router.get("/postulantes/{pid}/enlace")
async def ver_enlace(pid: str, user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    p, g, roles = await _postulante(db, pid, user)
    _exigir(roles, "capacitador", "gestion")
    e = (await db.execute(select(CapEnlace).where(CapEnlace.postulante_id == p.id))).scalar_one_or_none()
    if e is None:
        return {"activo": False, "url": None, "qr_svg": None, "ipv_estado": None}
    return _enlace_dict(e, seg.descifrar(e.token_enc))


@router.delete("/postulantes/{pid}/enlace")
async def revocar_enlace(pid: str, request: Request, user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    p, g, roles = await _postulante(db, pid, user)
    _exigir(roles, "capacitador", "gestion")
    e = (await db.execute(select(CapEnlace).where(CapEnlace.postulante_id == p.id))).scalar_one_or_none()
    if e is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No tiene link")
    e.activo, e.token_enc = False, None
    srv.evento(db, grupo_id=g.id, postulante_id=p.id, tipo="link_anulado", por=user.id)
    await db.commit()
    await record_action(db, user_id=user.id, action="capacitacion_link_anulado", resource_type="cap_postulante", resource_id=p.id,
                        ip=client_ip(request))
    return _enlace_dict(e, None)


# ------------------------------------------------------------------ seguimiento (comentarios con dictado)
class ComentarioNuevo(BaseModel):
    tipo: Literal["feedback", "oportunidad"] = "feedback"
    texto: str = Field("", max_length=4000)
    audio_id: Optional[str] = Field(None, max_length=36)


async def _audio_propio(db: AsyncSession, audio_id: Optional[str], pid: str, autor_id: Optional[str]) -> Optional[CapAudio]:
    if not audio_id:
        return None
    a = await db.get(CapAudio, audio_id)
    if not a or a.postulante_id != pid or a.autor_id != autor_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Audio no encontrado")
    return a


@router.post("/postulantes/{pid}/comentarios", status_code=status.HTTP_201_CREATED)
async def comentar(pid: str, payload: ComentarioNuevo, request: Request, user: CurrentUser = Depends(require_ver),
                   db: AsyncSession = Depends(get_db)) -> dict:
    """Un comentario de seguimiento (feedback u oportunidad de mejora). Si viene dictado y la transcripción no llegó,
    se guarda vacío y el texto se completa solo."""
    p, g, roles = await _postulante(db, pid, user)
    if g.estado == "cancelada":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El grupo está cancelado")
    a = await _audio_propio(db, payload.audio_id, p.id, user.id)
    texto = payload.texto.strip() or (a.texto if a and a.texto else "")
    if not texto and not a:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Escribí o dictá el comentario")
    c = CapComentario(postulante_id=p.id, grupo_id=g.id, autor_id=user.id, autor_rol=srv.rol_principal(roles), tipo=payload.tipo,
                      texto=texto, audio_id=a.id if a else None, created_at=srv.ahora())
    db.add(c)
    await db.commit()
    await record_action(db, user_id=user.id, action="capacitacion_comentario", resource_type="cap_postulante", resource_id=p.id,
                        ip=client_ip(request), extra={"tipo": c.tipo, "audio": bool(a)})
    quien = {user.id: user.full_name}
    return _comentario_dict(c, quien, {a.id: a} if a else {})


@router.post("/postulantes/{pid}/audios", status_code=status.HTTP_201_CREATED)
async def subir_audio(pid: str, request: Request, archivo: UploadFile = File(...), duracion: float = Form(...),
                      user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    p, g, roles = await _postulante(db, pid, user)
    if g.estado == "cancelada":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El grupo está cancelado")
    datos = await archivo.read(settings.transcripcion_max_mb * 1024 * 1024 + 1)
    try:
        a = await audios_srv.guardar(db, postulante_id=p.id, autor_id=user.id, datos=datos, duracion_s=duracion)
    except audios_srv.AudioInvalido as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    await db.commit()
    audios_srv.despertar()
    await record_action(db, user_id=user.id, action="capacitacion_audio", resource_type="cap_postulante", resource_id=p.id,
                        ip=client_ip(request), extra={"audio": a.id, "segundos": a.duracion_s, "sha256": a.sha256})
    return audios_srv.a_dict(a)


async def _audio_visible(db: AsyncSession, audio_id: str, user: CurrentUser) -> CapAudio:
    a = await db.get(CapAudio, audio_id)
    if not a:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Audio no encontrado")
    await _postulante(db, a.postulante_id, user)
    return a


@router.get("/audios/{audio_id}")
async def estado_audio(audio_id: str, user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    return audios_srv.a_dict(await _audio_visible(db, audio_id, user))


@router.get("/audios/{audio_id}/archivo")
async def escuchar_audio(audio_id: str, user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> FileResponse:
    a = await _audio_visible(db, audio_id, user)
    p = audios_srv.base.ruta(a.ruta) if a.borrado_at is None else None
    if p is None or not p.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "El audio ya no está guardado (queda su transcripción)")
    return FileResponse(p, media_type=a.mime, headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
                                                       "Content-Disposition": f'inline; filename="audio-{a.id[:8]}{p.suffix}"'})
