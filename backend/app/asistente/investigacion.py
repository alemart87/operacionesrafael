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
P_INF = "televentas_claro.informe_diario"
ESTADO_TEXTO = {"borrador": "borrador", "en_revision": "en revisión", "cerrado": "cerrado", "archivado": "archivado"}
CONFIDENCIAL = ("Esta pieza sale de una conversación que usó datos de Facturación (confidenciales): no se puede sumar a "
                "un informe de auditoría, que ven perfiles sin Facturación. Armala en una conversación nueva.")

def puede_investigar(user: CurrentUser) -> bool:
    return user.has_perm(P_AUD)


def puede_informe(user: CurrentUser) -> bool:
    """El modo informe diario es para quien prepara el informe diario (coordinador, sub gerente, superadmin…)."""
    return user.has_perm(P_INF)


def tipo(inv: Optional[dict[str, Any]]) -> str:
    """«auditor» (investigación de auditoría) o «informe_diario»; las conversaciones viejas no traen el tipo."""
    return str((inv or {}).get("tipo") or "auditor")


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


def alcance_de(a: Auditoria) -> str:
    """Las fuentes del informe por tipo, en una línea: «Ventas Netas: sep 2026 corte 22/09 · Logística: … · Supervisión: …»."""
    from ..operativas.televentas_claro.auditoria.fuentes import TIPOS, VENTAS_NETAS

    por_tipo: dict[str, list[str]] = {}
    for f in a.fuentes or []:
        tipo = f.get("tipo") or VENTAS_NETAS
        por_tipo.setdefault(tipo, []).append(str(f.get("etiqueta") or f.get("periodo") or f.get("id") or ""))
    partes = []
    for tipo, items in por_tipo.items():
        nombre = TIPOS.get(tipo, {}).get("nombre", tipo)
        partes.append(f"{nombre}: " + ", ".join(items[:6]) + (f" y {len(items) - 6} más" if len(items) > 6 else ""))
    return " · ".join(partes) or "sin fuentes"


def _destino(a: Auditoria) -> dict[str, Any]:
    return {"auditoria_id": a.id, "codigo": a.codigo, "titulo": a.titulo, "estado": a.status, "alcance": alcance_de(a)}


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
        destino = {k: previo.get(k) for k in ("auditoria_id", "codigo", "titulo", "estado", "alcance") if k in previo}
    nuevo = {"activo": True, **destino, "desde": previo.get("desde") or datetime.now(timezone.utc).isoformat(), "por": por}
    conv.investigacion = nuevo
    return nuevo


def desactivar(conv: AsistenteConversacion) -> None:
    conv.investigacion = None


async def activar_informe(db: AsyncSession, conv: AsistenteConversacion, user: CurrentUser, informe: Any = None,
                          fecha: Any = None, *, por: str = "usuario") -> dict[str, Any]:
    """Activa el modo informe diario con el borrador del usuario de ese día (hoy si no se indica; se crea si no existe)
    o con un informe suyo por id. ValueError con el motivo si no se puede."""
    from datetime import date

    from ..operativas.televentas_claro.informe_diario import api as inf_api
    from ..operativas.televentas_claro.informe_diario import informe as inf_srv
    from ..operativas.televentas_claro.informe_diario.models import BORRADOR, InformeDiario
    if not puede_informe(user):
        raise ValueError("El modo informe diario es para quien prepara el informe diario.")
    if informe:
        inf = await db.get(InformeDiario, str(informe)[:36])
        if inf is None or inf.autor_id != user.id:
            raise ValueError("No encontré ese informe diario (tiene que ser tuyo).")
    else:
        dia = inf_srv.hoy()
        try:
            f = date.fromisoformat(str(fecha)[:10]) if fecha else dia
        except ValueError as exc:
            raise ValueError("La fecha va como AAAA-MM-DD.") from exc
        try:
            inf_srv.validar_fecha(f, dia)
        except inf_srv.ReglaInvalida as exc:
            raise ValueError(str(exc)) from exc
        inf, _ = await inf_api.abrir_borrador(db, user, f)
    if inf.estado != BORRADOR:
        raise ValueError(f"El informe del {inf.fecha:%d/%m} ya está firmado: elegí otro día (hoy o hasta 7 días atrás).")
    previo = estado(conv) or {}
    desde = previo.get("desde") if tipo(previo) == "informe_diario" else None
    nuevo = {"activo": True, "tipo": "informe_diario", "informe_id": inf.id, "fecha": inf.fecha.isoformat(),
             "estado": inf.estado, "desde": desde or datetime.now(timezone.utc).isoformat(), "por": por}
    conv.investigacion = nuevo
    return nuevo


POSTURA = (
    "  Postura de auditor: escéptico, incisivo y RÁPIDO. Si hay informe destino, lo primero son SUS datos congelados: "
    "datos_de_auditoria (resumen y después la sección que haga falta: ventas_netas, cruce o cada módulo incluido). Si no "
    "hay informe destino, empezá por las netas y las cargas con alertas_del_corte (un solo llamado: último corte "
    "publicado con críticos, datos llamativos y hallazgos automáticos). Si el contexto lo amerita (una evolución o una concentración en pocos días o vendedores que una "
    "imagen explica mejor que una cifra) acompañá con un gráfico de netas o cargas en el lienzo; si alcanza con las "
    "cifras, no lo hagas. Después, solo si el usuario quiere profundizar, "
    "ventas_del_mes (líneas, cargas por día, un vendedor), el centro de comandos o los tickets. Respondé corto: una "
    "línea de conclusión y de 3 a 5 alertas de una línea cada una, con cifra, vendedor y fecha; nada de secciones ni "
    "listas largas. Separá hechos de hipótesis en una frase y cerrá con UN próximo paso (un hallazgo, un ticket o una "
    "figura) y la pregunta de por dónde seguir. Cada vez que muestres algo en el lienzo, preguntá qué piezas sumar con "
    "proponer_evidencia (elige en una tarjeta); nunca las sumes sin preguntar."
)
SUGERIR = (
    "- Modo auditor: disponible pero apagado. Si el usuario está investigando (alertas, vendedores en riesgo, líneas sin "
    "uso, ventas o cargas dudosas, auditorías o hallazgos), antes de seguir preguntale si quiere activarlo con "
    "proponer_modo_auditor (le aparece una tarjeta para aceptar). Si dice que no, seguí normal y no insistas en la "
    "misma conversación."
)
SUGERIR_INFORME = (
    "- Modo informe diario: disponible pero apagado. Si el usuario quiere armar, preparar o completar su informe diario "
    "con vos, activalo con modo_informe_diario (con la fecha si la dice) y trabajá en ese modo."
)
POSTURA_INFORME = (
    "  Modo informe diario: armás el informe CON el usuario, un paso por vez y en pocas líneas. 1) Consultá los datos "
    "del día del informe (productividad_del_dia, ventas_del_dia, supervision_del_mes para la proyección, "
    "coaching_del_dia) y contale lo relevante en 3 a 5 líneas. 2) Proponé los resultados de Pospago y GPON, un resumen "
    "de 3 a 5 líneas y las métricas críticas con compromiso; cuando él diga, cargalos con preparar_informe_diario "
    "(importá llamadas, cargas, proyección y coaching). 3) Cada gráfico o tablero que muestres en el lienzo ofrecelo "
    "como figura del informe con proponer_evidencia (elige en una tarjeta; nunca sumes sin preguntar); el título es "
    "la conclusión y la nota, la lectura para quien recibe el informe. 4) Nunca firmás: al final abrile el informe "
    "con abrir_pantalla para que lo revise y lo firme. Usá ofrecer_opciones para que apruebe cada paso con un botón."
)


def contexto_lineas(inv: Optional[dict[str, Any]], *, puede: bool = False, puede_informe: bool = False) -> list[str]:
    """Lo que Voi recibe en cada mensaje: la postura y el destino con el modo activo, o la sugerencia de activarlo."""
    if not inv:
        return ([SUGERIR] if puede else []) + ([SUGERIR_INFORME] if puede_informe else [])
    if tipo(inv) == "informe_diario":
        try:
            dia = datetime.fromisoformat(str(inv.get("fecha"))).strftime("%d/%m")
        except ValueError:
            dia = str(inv.get("fecha") or "")
        return [f"- MODO INFORME DIARIO ACTIVO. Informe destino: el informe diario del {dia} (borrador), ruta "
                f"/televentas-claro/informe-diario/{inv.get('informe_id')}.", POSTURA_INFORME]
    if inv.get("auditoria_id"):
        destino = (f"Informe destino: {inv.get('codigo')} «{inv.get('titulo')}» "
                   f"({ESTADO_TEXTO.get(inv.get('estado') or '', inv.get('estado') or '')}). "
                   f"Fuentes elegidas por el auditor (datos congelados): {inv.get('alcance') or 'ver datos_de_auditoria'}. "
                   "Leelas con datos_de_auditoria (una sección por llamado); las herramientas por módulo son para ampliar "
                   "con datos vivos, y si el auditor quiere sumar una fuente al informe, decile que la agregue desde Riesgos.")
    else:
        destino = ("Sin informe destino todavía: antes de proponer evidencia preguntale a qué informe va (consultá "
                   "auditorias_de_ventas) o ofrecé prepararlo con preparar_auditoria.")
    return [f"- MODO AUDITOR ACTIVO (investigación de auditoría). {destino}", POSTURA]


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
