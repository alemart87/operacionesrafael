"""API del informe diario — Televentas Claro.

* Lo preparan quienes tienen la utilidad `informe_diario` (coordinador y sub gerente por defecto) y el superadmin:
  uno por día, con los resultados del día, datos importados de la plataforma, el resumen, las métricas críticas con
  sus compromisos y la firma. Ven solo los suyos.
* El superadmin ve los de todos, los comenta, los marca revisados, sigue el cumplimiento y los compromisos, y edita
  el diccionario de palabras clave.
"""
from __future__ import annotations

import re
import unicodedata
from datetime import date, timedelta
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import CurrentUser, client_ip, require_perm, require_superadmin
from ....core.database import get_db
from ....core.perfiles import perfil_name
from ....services.audit_service import record_action
from . import importar as fuentes_srv
from . import informe as srv
from . import pdf as pdf_srv
from . import seguimiento as seguimiento_srv
from .models import BORRADOR, FIRMADO, OPERATIVA, InformeComentario, InformeDiario, InformeFirma, InformeParametros
from .palabras import TEMAS_DEFECTO, Diccionario, DiccionarioInvalido, validar as validar_diccionario

PERM = f"{OPERATIVA}.informe_diario"
require_informe = require_perm(PERM)

router = APIRouter(prefix="/televentas-claro/informe-diario", tags=["televentas-claro · informe diario"])

MAX_IMPORTADOS = 8
DIAS_LISTA = 45
DIAS_RACHA = 14
_ID = r"^[A-Za-z0-9_-]{1,40}$"


def _regla(exc: Exception) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))


# ------------------------------------------------------------------ acceso
async def _visible(db: AsyncSession, informe_id: str, user: CurrentUser) -> InformeDiario:
    inf = await db.get(InformeDiario, informe_id)
    if not inf or inf.operativa != OPERATIVA or not (user.is_superadmin or inf.autor_id == user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Informe no encontrado")
    return inf


async def _borrador_propio(db: AsyncSession, informe_id: str, user: CurrentUser) -> InformeDiario:
    inf = await _visible(db, informe_id, user)
    if inf.autor_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo su autor puede cambiar el informe")
    if inf.estado != BORRADOR:
        raise HTTPException(status.HTTP_409_CONFLICT, "El informe ya está firmado: no se cambia")
    return inf


async def _detalle(db: AsyncSession, inf: InformeDiario, user: CurrentUser) -> dict[str, Any]:
    dia = srv.hoy()
    coms = await srv.comentarios(db, [inf.id])
    es_autor = inf.autor_id == user.id
    out: dict[str, Any] = {
        **srv.a_dict(inf), "es_autor": es_autor, "puede_editar": es_autor and inf.estado == BORRADOR,
        "comentarios": [srv.comentario_dict(c) for c in coms], "nuevos": srv.nuevos_para_autor(inf, coms) if es_autor else 0,
        "verificacion": srv.verificar(inf), "hoy": dia.isoformat(), "dias_atras_max": srv.DIAS_ATRAS_MAX,
        "min_resumen": srv.MIN_RESUMEN, "max_importados": MAX_IMPORTADOS,
    }
    if out["puede_editar"]:
        out["compromisos_abiertos"] = [srv.compromiso_dict(c, dia) for c in await srv.compromisos_abiertos(db, inf.autor_id, inf.fecha)]
        prev = await srv.anterior(db, inf)
        out["anterior"] = None if not prev else {
            "id": prev.id, "fecha": prev.fecha.isoformat(),
            "pospago": ((prev.resultados or {}).get("pospago") or {}).get("valor"),
            "gpon": ((prev.resultados or {}).get("gpon") or {}).get("valor"),
            "metricas": [{"nombre": m.get("nombre"), "indicador": m.get("indicador"), "estado": m.get("estado")}
                         for m in prev.metricas or []]}
        f = await srv.firma_guardada(db, user.id)
        out["firma_guardada"] = {"imagen": f.imagen if f else None, "cargo": (f.cargo if f else None)}
    if user.is_superadmin:
        temas, _ = await srv.diccionario(db)
        dic = Diccionario(temas)
        out["palabras"] = srv.palabras_de(inf, dic)
        out["temas"] = {k: v for k, v in dic.temas.items()}
    return out


# ------------------------------------------------------------------ mis informes
@router.get("")
async def mis_informes(desde: Optional[date] = Query(None), hasta: Optional[date] = Query(None),
                       user: CurrentUser = Depends(require_informe), db: AsyncSession = Depends(get_db)) -> dict:
    """Los informes del usuario (los últimos 45 días), el de hoy, los últimos 14 días y sus compromisos abiertos."""
    dia = srv.hoy()
    hasta = hasta or dia
    desde = desde or hasta - timedelta(days=DIAS_LISTA)
    if desde > hasta or (hasta - desde).days > 400:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Rango inválido")
    infs = list((await db.execute(select(InformeDiario).where(
        InformeDiario.operativa == OPERATIVA, InformeDiario.autor_id == user.id,
        InformeDiario.fecha >= min(desde, dia - timedelta(days=DIAS_RACHA)), InformeDiario.fecha <= hasta,
    ).order_by(InformeDiario.fecha.desc()))).scalars().all())
    coms = await srv.comentarios(db, [i.id for i in infs])
    por: dict[str, list] = {}
    for c in coms:
        por.setdefault(c.informe_id, []).append(c)
    pesos, feriados = await seguimiento_srv.calendario(db)
    inicio = await srv.inicio(db)
    por_fecha = {i.fecha: i for i in infs}
    racha = []
    for k in range(DIAS_RACHA - 1, -1, -1):
        d = dia - timedelta(days=k)
        i = por_fecha.get(d)
        racha.append({"fecha": d.isoformat(), "id": i.id if i else None,
                      "estado": i.estado if i else ("hoy" if d == dia else
                                                    "falta" if seguimiento_srv.esperado(d, pesos, feriados, inicio) else "libre")})
    abiertos = await srv.compromisos_abiertos(db, user.id, dia + timedelta(days=1))
    items = [srv.resumen_dict(i, por.get(i.id, [])) for i in infs if desde <= i.fecha <= hasta]
    de_hoy = por_fecha.get(dia)
    return {
        "hoy": dia.isoformat(), "desde": desde.isoformat(), "hasta": hasta.isoformat(),
        "de_hoy": srv.resumen_dict(de_hoy, por.get(de_hoy.id, [])) if de_hoy else None,
        "racha": racha, "items": items,
        "compromisos": {"abiertos": len(abiertos), "vencidos": sum(1 for c in abiertos if c.fecha_limite and c.fecha_limite < dia),
                        "items": [srv.compromiso_dict(c, dia) for c in abiertos[:20]]},
        "nuevos": sum(x["nuevos"] for x in items), "dias_atras_max": srv.DIAS_ATRAS_MAX,
        "es_superadmin": user.is_superadmin,
    }


class CrearPayload(BaseModel):
    fecha: Optional[date] = None


@router.post("", status_code=status.HTTP_201_CREATED)
async def preparar(payload: CrearPayload, request: Request, response: Response, user: CurrentUser = Depends(require_informe),
                   db: AsyncSession = Depends(get_db)) -> dict:
    """«Preparar informe diario»: abre el borrador del día (o el informe que ya existe)."""
    dia = srv.hoy()
    fecha = payload.fecha or dia
    try:
        srv.validar_fecha(fecha, dia)
    except srv.ReglaInvalida as exc:
        raise _regla(exc) from exc
    inf = await srv.del_autor(db, user.id, fecha)
    if inf:
        response.status_code = status.HTTP_200_OK
        return {"id": inf.id, "nuevo": False, "estado": inf.estado}
    f = await srv.firma_guardada(db, user.id)
    inf = InformeDiario(operativa=OPERATIVA, fecha=fecha, autor_id=user.id, autor_nombre=user.full_name,
                        autor_cargo=(f.cargo if f and f.cargo else perfil_name(user.role)), estado=BORRADOR,
                        resultados={"pospago": {"valor": None, "meta": None, "comentario": ""},
                                    "gpon": {"valor": None, "meta": None, "comentario": ""}, "otros": []},
                        resumen="", metricas=[], importados=[], seguimiento=[], created_at=srv.ahora())
    db.add(inf)
    try:
        await db.commit()
    except IntegrityError:   # dos pedidos a la vez: vale el que llegó primero
        await db.rollback()
        inf = await srv.del_autor(db, user.id, fecha)
        response.status_code = status.HTTP_200_OK
        return {"id": inf.id, "nuevo": False, "estado": inf.estado}
    await record_action(db, user_id=user.id, action="informe_diario_creado", resource_type="informe_diario", resource_id=inf.id,
                        ip=client_ip(request), extra={"fecha": fecha.isoformat()})
    return {"id": inf.id, "nuevo": True, "estado": inf.estado}


# ------------------------------------------------------------------ fuentes para importar
@router.get("/fuentes")
async def fuentes(fecha: date = Query(...), user: CurrentUser = Depends(require_informe), db: AsyncSession = Depends(get_db)) -> dict:
    """Qué se puede importar para ese día (según los permisos del usuario) y de qué días hay datos."""
    return {"fecha": fecha.isoformat(), "fuentes": await fuentes_srv.fuentes(db, user, fecha)}


# ------------------------------------------------------------------ firma guardada
class FirmaPayload(BaseModel):
    imagen: Optional[str] = Field(None, max_length=200_000)
    cargo: Optional[str] = Field(None, max_length=120)


@router.get("/firma")
async def ver_firma(user: CurrentUser = Depends(require_informe), db: AsyncSession = Depends(get_db)) -> dict:
    f = await srv.firma_guardada(db, user.id)
    return {"imagen": f.imagen if f else None, "cargo": (f.cargo if f and f.cargo else perfil_name(user.role))}


@router.put("/firma")
async def guardar_firma(payload: FirmaPayload, request: Request, user: CurrentUser = Depends(require_informe),
                        db: AsyncSession = Depends(get_db)) -> dict:
    """La firma manuscrita (PNG dibujado) y el cargo, para reusarlos en cada informe."""
    try:
        imagen = srv.validar_imagen(payload.imagen) if payload.imagen else None
    except srv.ReglaInvalida as exc:
        raise _regla(exc) from exc
    f = await srv.firma_guardada(db, user.id) or InformeFirma(user_id=user.id)
    if payload.imagen is not None:
        f.imagen = imagen
    if payload.cargo is not None:
        f.cargo = payload.cargo.strip() or None
    f.updated_at = srv.ahora()
    db.add(f)
    await db.commit()
    await record_action(db, user_id=user.id, action="informe_diario_firma_guardada", resource_type="informe_diario_firma",
                        resource_id=user.id, ip=client_ip(request), extra={"con_imagen": bool(f.imagen)})
    return {"imagen": f.imagen, "cargo": f.cargo or perfil_name(user.role)}


@router.delete("/firma")
async def borrar_firma(request: Request, user: CurrentUser = Depends(require_informe), db: AsyncSession = Depends(get_db)) -> dict:
    f = await srv.firma_guardada(db, user.id)
    if f:
        f.imagen, f.updated_at = None, srv.ahora()
        await db.commit()
    await record_action(db, user_id=user.id, action="informe_diario_firma_borrada", resource_type="informe_diario_firma",
                        resource_id=user.id, ip=client_ip(request))
    return {"imagen": None, "cargo": (f.cargo if f and f.cargo else perfil_name(user.role))}


# ------------------------------------------------------------------ seguimiento (superadmin)
@router.get("/seguimiento")
async def seguimiento(desde: Optional[date] = Query(None), hasta: Optional[date] = Query(None),
                      autor_id: Optional[str] = Query(None, max_length=36), user: CurrentUser = Depends(require_superadmin),
                      db: AsyncSession = Depends(get_db)) -> dict:
    """Cumplimiento por autor y día, compromisos, comentarios y palabras clave del período (por defecto, 14 días)."""
    dia = srv.hoy()
    hasta = hasta or dia
    desde = desde or hasta - timedelta(days=13)
    if desde > hasta or (hasta - desde).days >= seguimiento_srv.DIAS_MAX:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"El rango puede tener hasta {seguimiento_srv.DIAS_MAX} días")
    return await seguimiento_srv.panel(db, desde=desde, hasta=hasta, autor_id=autor_id)


class Tema(BaseModel):
    clave: str = Field(..., max_length=30)
    nombre: str = Field(..., max_length=60)
    critico: bool = False
    palabras: list[str] = Field(default_factory=list, max_length=100)


class PalabrasPayload(BaseModel):
    temas: Optional[list[Tema]] = Field(None, max_length=20)
    restablecer: bool = False


async def _palabras(db: AsyncSession) -> dict[str, Any]:
    temas, row = await srv.diccionario(db)
    nombres = await _nombres_usuarios(db, {row.updated_by} if row and row.updated_by else set())
    return {"temas": temas, "por_defecto": not (row and (row.data or {}).get("temas")), "inicio": (row.data or {}).get("inicio") if row else None,
            "updated_at": srv.iso(row.updated_at) if row else None,
            "updated_by": nombres.get(row.updated_by) if row and row.updated_by else None,
            "reglas": {"alto": 3, "medio": 1, "ventana_negacion": 2}}


async def _nombres_usuarios(db: AsyncSession, ids: set[str]) -> dict[str, str]:
    from ..supervision.api import _nombres
    return await _nombres(db, ids)


@router.get("/palabras")
async def ver_palabras(user: CurrentUser = Depends(require_superadmin), db: AsyncSession = Depends(get_db)) -> dict:
    return await _palabras(db)


@router.put("/palabras")
async def guardar_palabras(payload: PalabrasPayload, request: Request, user: CurrentUser = Depends(require_superadmin),
                           db: AsyncSession = Depends(get_db)) -> dict:
    """El diccionario de palabras clave: temas, sus palabras (con * para las raíces) y cuáles son críticos."""
    row = await db.get(InformeParametros, OPERATIVA) or InformeParametros(operativa=OPERATIVA, data={})
    if payload.restablecer:
        row.data = {k: v for k, v in (row.data or {}).items() if k != "temas"}   # vuelve al diccionario por defecto
    else:
        try:
            temas = validar_diccionario([t.model_dump() for t in payload.temas or []])
        except DiccionarioInvalido as exc:
            raise _regla(exc) from exc
        row.data = {**(row.data or {}), "temas": temas}
    row.updated_at, row.updated_by = srv.ahora(), user.id
    db.add(row)
    await db.commit()
    await record_action(db, user_id=user.id, action="informe_diario_palabras", resource_type="informe_diario_palabras",
                        resource_id=OPERATIVA, ip=client_ip(request),
                        extra={"restablecer": payload.restablecer, "temas": len(payload.temas or TEMAS_DEFECTO)})
    return await _palabras(db)


# ------------------------------------------------------------------ un informe
@router.get("/{informe_id}")
async def ver(informe_id: str, user: CurrentUser = Depends(require_informe), db: AsyncSession = Depends(get_db)) -> dict:
    inf = await _visible(db, informe_id, user)
    out = await _detalle(db, inf, user)
    if inf.autor_id == user.id and out["comentarios"]:
        inf.leido_autor_at = srv.ahora()   # el autor vio los comentarios
        await db.commit()
    return out


class Resultado(BaseModel):
    valor: Optional[float] = Field(None, ge=0, le=1_000_000)
    meta: Optional[float] = Field(None, ge=0, le=1_000_000)
    comentario: str = Field("", max_length=500)


class OtroResultado(Resultado):
    id: str = Field(..., pattern=_ID)
    nombre: str = Field("", max_length=60)


class Resultados(BaseModel):
    pospago: Resultado = Field(default_factory=Resultado)
    gpon: Resultado = Field(default_factory=Resultado)
    otros: list[OtroResultado] = Field(default_factory=list, max_length=10)
    fuente: Optional[str] = Field(None, max_length=200)


class Metrica(BaseModel):
    id: str = Field(..., pattern=_ID)
    nombre: str = Field("", max_length=120)
    indicador: str = Field("", max_length=60)
    anterior: Optional[str] = Field(None, max_length=60)
    estado: Literal["critico", "atencion", "ok"] = "critico"
    comentario: str = Field("", max_length=1500)
    compromiso: str = Field("", max_length=1000)
    responsable: str = Field("", max_length=120)
    fecha_compromiso: Optional[date] = None


class SeguimientoItem(BaseModel):
    compromiso_id: str = Field(..., max_length=36)
    estado: Literal["cumplido", "en_curso", "no_cumplido"]
    nota: str = Field("", max_length=1000)


class GuardarPayload(BaseModel):
    resultados: Resultados = Field(default_factory=Resultados)
    resumen: str = Field("", max_length=5000)
    metricas: list[Metrica] = Field(default_factory=list, max_length=20)
    seguimiento: list[SeguimientoItem] = Field(default_factory=list, max_length=60)
    importados: list[str] = Field(default_factory=list, max_length=MAX_IMPORTADOS)   # ids a conservar, en orden
    cargo: Optional[str] = Field(None, max_length=120)


@router.put("/{informe_id}")
async def guardar(informe_id: str, payload: GuardarPayload, user: CurrentUser = Depends(require_informe),
                  db: AsyncSession = Depends(get_db)) -> dict:
    """Guarda el borrador (lo llama el guardado automático: no se audita cada vez)."""
    inf = await _borrador_propio(db, informe_id, user)
    abiertos = {c.id for c in await srv.compromisos_abiertos(db, inf.autor_id, inf.fecha)}
    actuales = {x["id"]: x for x in inf.importados or []}
    inf.resultados = payload.resultados.model_dump()
    inf.resumen = payload.resumen.strip()
    inf.metricas = [{**m.model_dump(), "fecha_compromiso": m.fecha_compromiso.isoformat() if m.fecha_compromiso else None}
                    for m in payload.metricas]
    inf.seguimiento = [s.model_dump() for s in payload.seguimiento if s.compromiso_id in abiertos]
    inf.importados = [actuales[i] for i in dict.fromkeys(payload.importados) if i in actuales]
    if payload.cargo is not None and payload.cargo.strip():
        inf.autor_cargo = payload.cargo.strip()
    inf.updated_at = srv.ahora()
    await db.commit()
    return {"id": inf.id, "updated_at": srv.iso(inf.updated_at)}


@router.delete("/{informe_id}")
async def descartar(informe_id: str, request: Request, user: CurrentUser = Depends(require_informe),
                    db: AsyncSession = Depends(get_db)) -> dict:
    inf = await _borrador_propio(db, informe_id, user)
    fecha = inf.fecha.isoformat()
    await db.delete(inf)
    await db.commit()
    await record_action(db, user_id=user.id, action="informe_diario_descartado", resource_type="informe_diario",
                        resource_id=informe_id, ip=client_ip(request), extra={"fecha": fecha})
    return {"status": "deleted"}


class ImportarPayload(BaseModel):
    tipo: Literal["llamadas", "cargas", "proyeccion", "coaching"]
    ref: str = Field(..., max_length=10)


@router.post("/{informe_id}/importar")
async def importar(informe_id: str, payload: ImportarPayload, request: Request, user: CurrentUser = Depends(require_informe),
                   db: AsyncSession = Depends(get_db)) -> dict:
    """Trae los datos de un módulo de la plataforma (calculados acá) y los deja congelados en el informe. Si ya había
    datos de la misma fuente y el mismo día, los reemplaza (se actualizan)."""
    inf = await _borrador_propio(db, informe_id, user)
    try:
        snap = await fuentes_srv.importar(db, user, payload.tipo, payload.ref)
    except fuentes_srv.FuenteNoDisponible as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"No tenés acceso a {exc}") from exc
    previos = [x for x in inf.importados or [] if not (x.get("tipo") == snap["tipo"] and x.get("fecha") == snap["fecha"])]
    if len(previos) >= MAX_IMPORTADOS:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Se pueden importar hasta {MAX_IMPORTADOS} reportes")
    reemplazo = len(previos) < len(inf.importados or [])
    inf.importados = [*previos, snap]
    inf.updated_at = srv.ahora()
    await db.commit()
    await record_action(db, user_id=user.id, action="informe_diario_importado", resource_type="informe_diario", resource_id=inf.id,
                        ip=client_ip(request), extra={"tipo": payload.tipo, "ref": payload.ref, "reemplazo": reemplazo})
    return {"importado": snap, "reemplazo": reemplazo, "importados": inf.importados}


class FirmarPayload(BaseModel):
    cargo: str = Field(..., min_length=2, max_length=120)
    con_firma: bool = False


@router.post("/{informe_id}/firmar")
async def firmar(informe_id: str, payload: FirmarPayload, request: Request, user: CurrentUser = Depends(require_informe),
                 db: AsyncSession = Depends(get_db)) -> dict:
    """Firma y cierra el informe: aplica el seguimiento de los compromisos, crea los nuevos y genera el código."""
    inf = await _borrador_propio(db, informe_id, user)
    f = await srv.firma_guardada(db, user.id)
    if payload.con_firma and not (f and f.imagen):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Primero dibujá y guardá tu firma")
    cargo = payload.cargo.strip()
    try:
        await srv.firmar(db, inf, nombre=user.full_name, cargo=cargo, imagen=f.imagen if payload.con_firma and f else None)
    except srv.ReglaInvalida as exc:
        raise _regla(exc) from exc
    f = f or InformeFirma(user_id=user.id)
    f.cargo, f.updated_at = cargo, srv.ahora()
    db.add(f)
    await db.commit()
    await record_action(db, user_id=user.id, action="informe_diario_firmado", resource_type="informe_diario", resource_id=inf.id,
                        ip=client_ip(request), extra={"fecha": inf.fecha.isoformat(), "codigo": (inf.firma or {}).get("codigo"),
                                                     "metricas": len(inf.metricas or []), "importados": len(inf.importados or [])})
    return await _detalle(db, inf, user)


def _archivo(inf: InformeDiario) -> str:
    base = unicodedata.normalize("NFKD", inf.autor_nombre).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^A-Za-z0-9]+", "-", base).strip("-")[:40] or "autor"
    return f"Informe-diario_{inf.fecha.isoformat()}_{slug}{'' if inf.estado == FIRMADO else '_BORRADOR'}.pdf"


@router.get("/{informe_id}/pdf")
async def descargar_pdf(informe_id: str, request: Request, user: CurrentUser = Depends(require_informe),
                        db: AsyncSession = Depends(get_db)) -> Response:
    """El PDF para enviar: con la firma y el código si está firmado; con la marca «BORRADOR» si no."""
    inf = await _visible(db, informe_id, user)
    contenido = pdf_srv.generar(srv.a_dict(inf))
    await record_action(db, user_id=user.id, action="informe_diario_pdf", resource_type="informe_diario", resource_id=inf.id,
                        ip=client_ip(request), extra={"fecha": inf.fecha.isoformat(), "estado": inf.estado})
    return Response(contenido, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{_archivo(inf)}"', "Cache-Control": "no-store"})


class ComentarioPayload(BaseModel):
    texto: str = Field(..., max_length=2000)


@router.post("/{informe_id}/comentarios", status_code=status.HTTP_201_CREATED)
async def comentar(informe_id: str, payload: ComentarioPayload, request: Request, user: CurrentUser = Depends(require_informe),
                   db: AsyncSession = Depends(get_db)) -> dict:
    """El superadmin comenta el informe firmado; su autor le responde."""
    inf = await _visible(db, informe_id, user)
    if inf.estado != FIRMADO:
        raise HTTPException(status.HTTP_409_CONFLICT, "Se comenta el informe ya firmado")
    texto = payload.texto.strip()
    if len(texto) < 2:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Escribí el comentario")
    rol = "superadmin" if user.is_superadmin else "autor"
    momento = srv.ahora()
    db.add(InformeComentario(informe_id=inf.id, autor_id=user.id, autor_nombre=user.full_name, rol=rol, texto=texto,
                             created_at=momento))
    if rol == "superadmin" and not inf.revisado_at:
        inf.revisado_at, inf.revisado_por = momento, user.id
    if inf.autor_id == user.id:
        inf.leido_autor_at = momento
    await db.commit()
    await record_action(db, user_id=user.id, action="informe_diario_comentario", resource_type="informe_diario", resource_id=inf.id,
                        ip=client_ip(request), extra={"rol": rol})
    return {"comentarios": [srv.comentario_dict(c) for c in await srv.comentarios(db, [inf.id])],
            "revisado_at": srv.iso(inf.revisado_at)}


class RevisadoPayload(BaseModel):
    revisado: bool = True


@router.post("/{informe_id}/revisado")
async def revisado(informe_id: str, payload: RevisadoPayload, request: Request, user: CurrentUser = Depends(require_superadmin),
                   db: AsyncSession = Depends(get_db)) -> dict:
    inf = await _visible(db, informe_id, user)
    if inf.estado != FIRMADO:
        raise HTTPException(status.HTTP_409_CONFLICT, "Se revisa el informe ya firmado")
    inf.revisado_at, inf.revisado_por = (srv.ahora(), user.id) if payload.revisado else (None, None)
    await db.commit()
    await record_action(db, user_id=user.id, action="informe_diario_revisado", resource_type="informe_diario", resource_id=inf.id,
                        ip=client_ip(request), extra={"revisado": payload.revisado})
    return {"revisado_at": srv.iso(inf.revisado_at)}
