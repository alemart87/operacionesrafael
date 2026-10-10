"""Reglas del informe diario: quién lo ve, cómo se firma (con su código de verificación) y cómo siguen los
compromisos de un día al otro.

- Uno por autor y fecha (de hoy o de hasta 7 días atrás). Mientras es borrador lo edita solo su autor.
- Para firmarlo hacen falta los resultados del día (Pospago y GPON, pueden ser 0) y un resumen. Al firmar queda
  cerrado: se guarda la firma (nombre, cargo y, si se elige, la firma manuscrita) y un código de verificación que
  sale del contenido (SHA-256): si alguien cambiara el informe en la base, deja de coincidir.
- Los compromisos de las métricas pasan a `informes_diarios_compromisos`. En los informes siguientes el autor dice
  si se cumplieron, siguen en curso o no se cumplieron; cumplido y no cumplido los cierran.
- Lo ven su autor y el superadmin, que lo comenta y lo marca revisado.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import io
import json
from datetime import date, datetime, timezone
from typing import Any, Iterable
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import (
    ABIERTO, CUMPLIDO, FIRMADO, NO_CUMPLIDO, OPERATIVA, InformeComentario, InformeCompromiso, InformeDiario, InformeFirma,
    InformeParametros,
)
from .palabras import TEMAS_DEFECTO, Diccionario, analizar

ZONA = ZoneInfo("America/Asuncion")
DIAS_ATRAS_MAX = 7
MIN_RESUMEN = 20
MAX_FIRMA_BYTES = 120_000
MAX_FIRMA_LADO = (1600, 800)
ESTADOS_SEGUIMIENTO = ("cumplido", "en_curso", "no_cumplido")


class ReglaInvalida(ValueError):
    """El informe no cumple una regla (el mensaje es para el usuario)."""


def ahora() -> datetime:
    return datetime.now(timezone.utc)


def hoy() -> date:
    return datetime.now(ZONA).date()


def utc(d: datetime | None) -> datetime | None:
    return d.replace(tzinfo=timezone.utc) if d is not None and d.tzinfo is None else d


def iso(d: datetime | None) -> str | None:
    return utc(d).isoformat() if d else None


def validar_fecha(fecha: date, dia: date) -> None:
    if fecha > dia:
        raise ReglaInvalida("La fecha no puede ser futura")
    if (dia - fecha).days > DIAS_ATRAS_MAX:
        raise ReglaInvalida(f"Se puede preparar el informe de hoy o de hasta {DIAS_ATRAS_MAX} días atrás")


# ------------------------------------------------------------------ firma manuscrita (PNG)
def validar_imagen(data_url: str) -> str:
    """Una firma dibujada: PNG en base64, liviano y de un tamaño razonable (lo comprueba Pillow)."""
    prefijo = "data:image/png;base64,"
    if not data_url.startswith(prefijo):
        raise ReglaInvalida("La firma tiene que ser una imagen PNG")
    try:
        crudo = base64.b64decode(data_url[len(prefijo):], validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ReglaInvalida("La imagen de la firma no es válida") from exc
    if len(crudo) > MAX_FIRMA_BYTES:
        raise ReglaInvalida("La imagen de la firma es demasiado grande")
    if not crudo.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ReglaInvalida("La firma tiene que ser una imagen PNG")
    from PIL import Image
    try:
        with Image.open(io.BytesIO(crudo)) as im:
            im.verify()
            ancho, alto = im.size
    except Exception as exc:  # noqa: BLE001 — cualquier error de Pillow es una imagen inválida
        raise ReglaInvalida("La imagen de la firma no es válida") from exc
    if ancho > MAX_FIRMA_LADO[0] or alto > MAX_FIRMA_LADO[1] or ancho < 20 or alto < 10:
        raise ReglaInvalida("La firma tiene un tamaño fuera de lo esperado")
    return data_url


# ------------------------------------------------------------------ código de verificación
def _contenido(inf: InformeDiario) -> dict[str, Any]:
    firma = inf.firma or {}
    imagen = firma.get("imagen")
    return {
        "operativa": inf.operativa, "fecha": inf.fecha.isoformat(), "autor_id": inf.autor_id, "autor": firma.get("nombre"),
        "cargo": firma.get("cargo"), "firmado_at": firma.get("firmado_at"), "resultados": inf.resultados or {},
        "resumen": inf.resumen or "", "metricas": inf.metricas or [], "importados": inf.importados or [],
        "seguimiento": inf.seguimiento or [], "imagen": hashlib.sha256(imagen.encode()).hexdigest() if imagen else None,
    }


def huella(inf: InformeDiario) -> str:
    crudo = json.dumps(_contenido(inf), sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)
    return hashlib.sha256(crudo.encode()).hexdigest()


def codigo(h: str) -> str:
    return "-".join(h[i:i + 4] for i in (0, 4, 8)).upper()


def verificar(inf: InformeDiario) -> bool | None:
    return None if inf.estado != FIRMADO or not inf.hash else huella(inf) == inf.hash


# ------------------------------------------------------------------ consultas
async def del_autor(db: AsyncSession, autor_id: str, fecha: date) -> InformeDiario | None:
    return (await db.execute(select(InformeDiario).where(
        InformeDiario.operativa == OPERATIVA, InformeDiario.autor_id == autor_id, InformeDiario.fecha == fecha))).scalars().first()


async def anterior(db: AsyncSession, inf: InformeDiario) -> InformeDiario | None:
    """El último informe firmado del mismo autor antes de esa fecha."""
    return (await db.execute(select(InformeDiario).where(
        InformeDiario.operativa == OPERATIVA, InformeDiario.autor_id == inf.autor_id, InformeDiario.estado == FIRMADO,
        InformeDiario.fecha < inf.fecha).order_by(InformeDiario.fecha.desc()).limit(1))).scalars().first()


async def compromisos_abiertos(db: AsyncSession, autor_id: str, antes_de: date) -> list[InformeCompromiso]:
    return list((await db.execute(select(InformeCompromiso).where(
        InformeCompromiso.operativa == OPERATIVA, InformeCompromiso.autor_id == autor_id,
        InformeCompromiso.estado == ABIERTO, InformeCompromiso.fecha < antes_de,
    ).order_by(InformeCompromiso.fecha, InformeCompromiso.created_at))).scalars().all())


async def comentarios(db: AsyncSession, informe_ids: Iterable[str]) -> list[InformeComentario]:
    ids = list(informe_ids)
    if not ids:
        return []
    return list((await db.execute(select(InformeComentario).where(InformeComentario.informe_id.in_(ids))
                                  .order_by(InformeComentario.created_at))).scalars().all())


async def diccionario(db: AsyncSession) -> tuple[list[dict[str, Any]], InformeParametros | None]:
    row = await db.get(InformeParametros, OPERATIVA)
    temas = (row.data or {}).get("temas") if row else None
    return (temas or TEMAS_DEFECTO), row


async def inicio(db: AsyncSession) -> date | None:
    """Desde cuándo se espera el informe diario (el día en que se instaló): antes no hay días que falten."""
    row = await db.get(InformeParametros, OPERATIVA)
    x = (row.data or {}).get("inicio") if row else None
    return date.fromisoformat(x) if x else None


async def firma_guardada(db: AsyncSession, user_id: str) -> InformeFirma | None:
    return await db.get(InformeFirma, user_id)


# ------------------------------------------------------------------ texto para las palabras clave
def campos_texto(inf: InformeDiario) -> list[tuple[str, str]]:
    r = inf.resultados or {}
    out: list[tuple[str, str]] = [("resumen", inf.resumen or "")]
    for k in ("pospago", "gpon"):
        out.append((f"resultados.{k}.comentario", (r.get(k) or {}).get("comentario") or ""))
    for i, o in enumerate(r.get("otros") or []):
        out.append((f"resultados.otros.{i}.nombre", o.get("nombre") or ""))
        out.append((f"resultados.otros.{i}.comentario", o.get("comentario") or ""))
    for i, m in enumerate(inf.metricas or []):
        for c in ("nombre", "comentario", "compromiso"):
            out.append((f"metricas.{i}.{c}", m.get(c) or ""))
    for i, s in enumerate(inf.seguimiento or []):
        out.append((f"seguimiento.{i}.nota", s.get("nota") or ""))
    return out


def palabras_de(inf: InformeDiario, dic: Diccionario) -> dict[str, Any]:
    return analizar(campos_texto(inf), dic)


# ------------------------------------------------------------------ firmar
def validar_para_firmar(inf: InformeDiario) -> None:
    r = inf.resultados or {}
    if any((r.get(k) or {}).get("valor") is None for k in ("pospago", "gpon")):
        raise ReglaInvalida("Completá los resultados del día: Pospago y GPON (pueden ser 0)")
    if len((inf.resumen or "").strip()) < MIN_RESUMEN:
        raise ReglaInvalida(f"Escribí el resumen del día (al menos {MIN_RESUMEN} caracteres)")
    for m in inf.metricas or []:
        if not (m.get("nombre") or "").strip():
            raise ReglaInvalida("Cada métrica crítica necesita un nombre")


async def firmar(db: AsyncSession, inf: InformeDiario, *, nombre: str, cargo: str, imagen: str | None) -> None:
    """Cierra el informe: seguimiento de los compromisos anteriores, compromisos nuevos, firma y código."""
    validar_para_firmar(inf)
    momento = ahora()
    prev = await anterior(db, inf)
    if prev:
        pr = prev.resultados or {}
        inf.resultados = {**(inf.resultados or {}), "anterior": {
            "fecha": prev.fecha.isoformat(), "pospago": (pr.get("pospago") or {}).get("valor"),
            "gpon": (pr.get("gpon") or {}).get("valor")}}
    # Seguimiento de los compromisos anteriores: se aplica y queda con su texto (para el PDF).
    abiertos = {c.id: c for c in await compromisos_abiertos(db, inf.autor_id, inf.fecha)}
    seguimiento = []
    for s in inf.seguimiento or []:
        c = abiertos.get(s.get("compromiso_id"))
        if not c or s.get("estado") not in ESTADOS_SEGUIMIENTO:
            continue
        nota = (s.get("nota") or "").strip()
        c.historial = [*(c.historial or []), {"fecha": inf.fecha.isoformat(), "informe_id": inf.id, "estado": s["estado"], "nota": nota}]
        if s["estado"] in (CUMPLIDO, NO_CUMPLIDO):
            c.estado, c.cerrado_en, c.cerrado_fecha = s["estado"], inf.id, inf.fecha
        c.updated_at = momento
        seguimiento.append({"compromiso_id": c.id, "estado": s["estado"], "nota": nota, "metrica": c.metrica, "texto": c.texto,
                            "desde": c.fecha.isoformat(), "fecha_limite": c.fecha_limite.isoformat() if c.fecha_limite else None})
    inf.seguimiento = seguimiento
    # Compromisos nuevos: los de las métricas.
    for m in inf.metricas or []:
        texto = (m.get("compromiso") or "").strip()
        if not texto:
            continue
        limite = m.get("fecha_compromiso")
        db.add(InformeCompromiso(operativa=inf.operativa, informe_id=inf.id, autor_id=inf.autor_id, fecha=inf.fecha,
                                 metrica=(m.get("nombre") or "")[:120], texto=texto, responsable=(m.get("responsable") or None),
                                 fecha_limite=date.fromisoformat(limite) if limite else None, estado=ABIERTO, historial=[],
                                 created_at=momento))
    inf.autor_cargo = cargo
    inf.firma = {"nombre": nombre, "cargo": cargo, "imagen": imagen, "firmado_at": momento.isoformat()}
    inf.estado, inf.firmado_at, inf.updated_at = FIRMADO, momento, momento
    inf.hash = huella(inf)
    inf.firma = {**inf.firma, "codigo": codigo(inf.hash)}


# ------------------------------------------------------------------ salida
def comentario_dict(c: InformeComentario) -> dict[str, Any]:
    return {"id": c.id, "autor": c.autor_nombre, "autor_id": c.autor_id, "rol": c.rol, "texto": c.texto, "at": iso(c.created_at)}


def compromiso_dict(c: InformeCompromiso, dia: date) -> dict[str, Any]:
    ultimo = (c.historial or [])[-1] if c.historial else None
    return {"id": c.id, "informe_id": c.informe_id, "fecha": c.fecha.isoformat(), "metrica": c.metrica, "texto": c.texto,
            "responsable": c.responsable, "fecha_limite": c.fecha_limite.isoformat() if c.fecha_limite else None,
            "estado": c.estado, "vencido": bool(c.estado == ABIERTO and c.fecha_limite and c.fecha_limite < dia),
            "ultimo": ultimo, "cerrado_fecha": c.cerrado_fecha.isoformat() if c.cerrado_fecha else None}


def nuevos_para_autor(inf: InformeDiario, coms: list[InformeComentario]) -> int:
    leido = utc(inf.leido_autor_at)
    return sum(1 for c in coms if c.rol == "superadmin" and (leido is None or utc(c.created_at) > leido))


def resumen_dict(inf: InformeDiario, coms: list[InformeComentario]) -> dict[str, Any]:
    r = inf.resultados or {}
    ms = inf.metricas or []
    return {
        "id": inf.id, "fecha": inf.fecha.isoformat(), "estado": inf.estado, "autor_id": inf.autor_id, "autor": inf.autor_nombre,
        "cargo": inf.autor_cargo, "resumen": (inf.resumen or "")[:220],
        "pospago": (r.get("pospago") or {}).get("valor"), "gpon": (r.get("gpon") or {}).get("valor"),
        "metricas": len(ms), "criticas": sum(1 for m in ms if m.get("estado") == "critico"),
        "importados": len(inf.importados or []), "comentarios": len(coms), "nuevos": nuevos_para_autor(inf, coms),
        "firmado_at": iso(inf.firmado_at), "updated_at": iso(inf.updated_at or inf.created_at),
        "revisado_at": iso(inf.revisado_at), "codigo": (inf.firma or {}).get("codigo"),
    }


def a_dict(inf: InformeDiario) -> dict[str, Any]:
    return {
        "id": inf.id, "fecha": inf.fecha.isoformat(), "estado": inf.estado, "autor_id": inf.autor_id, "autor": inf.autor_nombre,
        "cargo": inf.autor_cargo, "resultados": inf.resultados or {}, "resumen": inf.resumen or "",
        "metricas": inf.metricas or [], "importados": inf.importados or [], "seguimiento": inf.seguimiento or [],
        "firma": inf.firma, "firmado_at": iso(inf.firmado_at), "created_at": iso(inf.created_at),
        "updated_at": iso(inf.updated_at or inf.created_at), "revisado_at": iso(inf.revisado_at),
    }
