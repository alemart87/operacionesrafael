"""Modo auditor de Voi: una conversación que es una investigación de auditoría.

Lo activa quien tiene la utilidad Auditoría de ventas (el auditor, el superadmin, el sub gerente…), desde el panel o
Voi con la herramienta `modo_auditor`. Mientras está activo:

- el panel, el lienzo y el botón de Voi llevan un borde fino en los colores de Voicenter (lo dibuja el navegador);
- cada mensaje le recuerda a Voi el **informe destino** y que, cada vez que muestre algo en el lienzo, le pregunte al
  usuario qué piezas sumar (herramienta `proponer_evidencia`: el usuario elige en una tarjeta);
- el usuario también puede elegir piezas (o partes de un tablero) directo en el lienzo y sumarlas al informe.

Las piezas se congelan como figuras del informe (`auditoria.evidencias`). Nunca se suma una pieza de otra persona ni
una de una conversación que usó datos de Facturación (confidenciales: el informe lo ven perfiles sin Facturación).
La API (activar desde el panel, sumar desde el lienzo) está en `investigacion_api.py`; las herramientas de Voi, en
`herramientas/investigacion.py`.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..api.deps import CurrentUser
from ..operativas.televentas_claro.auditoria.models import ESTADOS_EDITABLES, Auditoria
from . import difusion
from .models import AsistenteAccion, AsistenteArtefacto, AsistenteConversacion

P_AUD = "televentas_claro.auditoria"
ESTADO_TEXTO = {"borrador": "borrador", "en_revision": "en revisión", "cerrado": "cerrado", "archivado": "archivado"}
CONFIDENCIAL = ("Esta pieza sale de una conversación que usó datos de Facturación (confidenciales): no se puede sumar a "
                "un informe de auditoría, que ven perfiles sin Facturación. Armala en una conversación nueva.")

def puede_investigar(user: CurrentUser) -> bool:
    return user.has_perm(P_AUD)


# ------------------------------------------------------------------ estado de la conversación
def estado(conv: Optional[AsistenteConversacion]) -> Optional[dict[str, Any]]:
    inv = conv.investigacion if conv is not None else None
    return inv if isinstance(inv, dict) and inv.get("activo") else None


async def informe(db: AsyncSession, valor: Any) -> Optional[Auditoria]:
    """Un informe de auditoría por id o por código (AUD-2026-003)."""
    v = str(valor or "").strip()
    if not v:
        return None
    a = await db.get(Auditoria, v[:36])
    if a is None and re.fullmatch(r"(?i)aud-\d{4}-\d{1,4}", v):
        a = (await db.execute(select(Auditoria).where(func.upper(Auditoria.codigo) == v.upper()))).scalar_one_or_none()
    return a


def _destino(a: Auditoria) -> dict[str, Any]:
    return {"auditoria_id": a.id, "codigo": a.codigo, "titulo": a.titulo, "estado": a.status}


async def activar(db: AsyncSession, conv: AsistenteConversacion, user: CurrentUser, auditoria: Any = None, *,
                  por: str = "usuario", conservar_destino: bool = True) -> dict[str, Any]:
    """Activa el modo (o cambia el informe destino). ValueError con el motivo si no se puede."""
    if not puede_investigar(user):
        raise ValueError("El modo auditor es para quien tiene la utilidad Auditoría de ventas.")
    previo = estado(conv) or {}
    destino: dict[str, Any] = {}
    if auditoria:
        a = await informe(db, auditoria)
        if a is None:
            raise ValueError("No encontré ese informe de auditoría.")
        if a.status not in ESTADOS_EDITABLES:
            raise ValueError(f"El informe {a.codigo} está {ESTADO_TEXTO.get(a.status, a.status)}: elegí uno en borrador "
                             "o en revisión (o reabrilo).")
        destino = _destino(a)
    elif conservar_destino and previo.get("auditoria_id"):
        destino = {k: previo.get(k) for k in ("auditoria_id", "codigo", "titulo", "estado")}
    nuevo = {"activo": True, **destino, "desde": previo.get("desde") or datetime.now(timezone.utc).isoformat(), "por": por}
    conv.investigacion = nuevo
    return nuevo


def desactivar(conv: AsistenteConversacion) -> None:
    conv.investigacion = None


def contexto_lineas(inv: Optional[dict[str, Any]]) -> list[str]:
    """Lo que Voi recibe en cada mensaje mientras el modo está activo."""
    if not inv:
        return []
    if inv.get("auditoria_id"):
        destino = (f"Informe destino: {inv.get('codigo')} «{inv.get('titulo')}» "
                   f"({ESTADO_TEXTO.get(inv.get('estado') or '', inv.get('estado') or '')}).")
    else:
        destino = ("Sin informe destino todavía: antes de proponer evidencia preguntale a qué informe va (consultá "
                   "auditorias_de_ventas) o ofrecé prepararlo con preparar_auditoria.")
    return [
        f"- MODO AUDITOR ACTIVO (investigación de auditoría). {destino}",
        "  Trabajá como auditor: datos verificables, hallazgos con evidencia y conclusiones prudentes. Cada vez que "
        "muestres algo en el lienzo, preguntale qué piezas quiere sumar al informe con proponer_evidencia (el usuario "
        "elige en una tarjeta); nunca las sumes sin preguntar.",
    ]


def publicar(cid: str, inv: Optional[dict[str, Any]]) -> None:
    difusion.publicar(cid, {"tipo": "investigacion", "investigacion": inv})


# ------------------------------------------------------------------ piezas del lienzo → figuras del informe
async def usa_facturacion(db: AsyncSession, conversacion_id: str) -> bool:
    n = (await db.execute(select(func.count()).select_from(AsistenteAccion).where(
        AsistenteAccion.conversacion_id == conversacion_id, AsistenteAccion.herramienta.like("facturacion_%")))).scalar()
    return bool(n)


def clave(artefacto_id: str, widget: Optional[int]) -> str:
    return artefacto_id if widget is None else f"{artefacto_id}#{widget}"


async def pieza(db: AsyncSession, user: CurrentUser, *, artefacto_id: Optional[str] = None, widget: Optional[int] = None,
                spec: Optional[dict[str, Any]] = None, conversacion_id: Optional[str] = None) -> dict[str, Any]:
    """Valida una pieza que se quiere sumar a un informe y devuelve {spec, conversacion_id, artefacto_id}.
    ValueError con el motivo (para el usuario o para Voi)."""
    if artefacto_id:
        art = await db.get(AsistenteArtefacto, str(artefacto_id)[:36])
        if art is None or art.user_id != user.id:          # nunca una pieza de otra persona
            raise ValueError("Esa pieza del lienzo no existe o no es tuya.")
        if art.confidencial or await usa_facturacion(db, art.conversacion_id):
            raise ValueError(CONFIDENCIAL)
        base = art.spec or {}
        if widget is not None:
            partes = base.get("widgets") or []
            if base.get("tipo") != "tablero" or not 0 <= widget < len(partes):
                raise ValueError("Esa parte del tablero no existe.")
            base = partes[widget]
        return {"spec": base, "conversacion_id": art.conversacion_id, "artefacto_id": clave(art.id, widget)}
    if spec is not None:
        # Pieza armada en el navegador (p. ej. una tabla de una respuesta): se valida como cualquier otra.
        if not conversacion_id:
            raise ValueError("Falta la conversación de la que sale la pieza.")
        conv = await db.get(AsistenteConversacion, conversacion_id)
        if conv is None or conv.user_id != user.id:
            raise ValueError("Esa conversación no existe o no es tuya.")
        if await usa_facturacion(db, conv.id):
            raise ValueError(CONFIDENCIAL)
        from .herramientas.base import ErrorHerramienta
        from .herramientas.lienzo import normalizar
        try:
            limpia, _ = normalizar(spec)
        except ErrorHerramienta as exc:
            raise ValueError(f"La pieza no es válida: {exc}") from exc
        return {"spec": limpia, "conversacion_id": conv.id, "artefacto_id": None}
    raise ValueError("Indicá la pieza del lienzo.")
