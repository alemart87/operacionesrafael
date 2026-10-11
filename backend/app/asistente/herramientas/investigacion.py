"""El modo auditor como herramientas de Voi.

- `modo_auditor`: entra (o sale) del modo investigación de auditoría y fija el informe destino. El panel, el lienzo y
  el botón de Voi lo muestran con un borde en los colores de Voicenter.
- `proponer_evidencia`: propone sumar piezas del lienzo al informe. La plataforma muestra una tarjeta con cada pieza
  (y una casilla): el usuario elige cuáles van, puede retocar el título y la nota, y confirma. Solo se suma lo elegido.
"""
from __future__ import annotations

from typing import Any, Optional

from ...operativas.televentas_claro.auditoria import evidencias
from .. import investigacion
from ..models import AsistenteConversacion
from .base import CONFIRMAR, CONSULTAR, TC, Ctx, ErrorHerramienta, Herramienta, esquema, registrar

P_AUD = f"{TC}.auditoria"
MAX_PIEZAS = 8


async def _conv(ctx: Ctx) -> AsistenteConversacion:
    conv = await ctx.db.get(AsistenteConversacion, ctx.conversacion_id)
    if conv is None:
        raise ErrorHerramienta("No encontré la conversación.")
    return conv


def _publicar(ctx: Ctx, inv: Optional[dict[str, Any]]) -> None:
    ctx.extra.setdefault("publicar", []).append({"tipo": "investigacion", "investigacion": inv})


# ------------------------------------------------------------------ modo auditor
async def _modo(ctx: Ctx, e: dict[str, Any]) -> Any:
    conv = await _conv(ctx)
    if e.get("accion") == "desactivar":
        investigacion.desactivar(conv)
        _publicar(ctx, None)
        return {"modo_auditor": "inactivo", "mensaje": "Saliste del modo auditor."}
    try:
        inv = await investigacion.activar(ctx.db, conv, ctx.user, e.get("auditoria"), por="voi")
    except ValueError as exc:
        raise ErrorHerramienta(str(exc)) from exc
    _publicar(ctx, inv)
    destino = ({"codigo": inv["codigo"], "titulo": inv["titulo"], "estado": inv["estado"],
                "pantalla": f"/televentas-claro/auditoria/informes/{inv['auditoria_id']}"} if inv.get("auditoria_id") else None)
    return {
        "modo_auditor": "activo", "informe_destino": destino,
        "indicaciones": ("El panel y el lienzo ya muestran el modo auditor. Cada vez que muestres algo en el lienzo, "
                         "preguntá qué piezas sumar con proponer_evidencia." if destino else
                         "No hay informe destino: preguntá a qué informe va la evidencia (auditorias_de_ventas) o "
                         "ofrecé prepararlo con preparar_auditoria; después volvé a llamar a modo_auditor con él."),
    }


registrar(Herramienta(
    nombre="modo_auditor", etiqueta="Cambiando el modo auditor", nivel=CONSULTAR,
    descripcion=("Entra (o sale) del MODO AUDITOR: la conversación pasa a ser una investigación de auditoría y el "
                 "panel, el lienzo y el botón de Voi lo muestran con un borde en los colores de Voicenter. Usala cuando el usuario "
                 "empieza una investigación (revisar vendedores, alertas o ventas para un informe de auditoría) o cuando "
                 "lo pide. `auditoria`: el informe destino (id o código AUD-…, en borrador o en revisión); sin él se "
                 "conserva el que había. Mientras esté activo, cada vez que muestres algo en el lienzo preguntá qué "
                 "piezas sumar al informe con proponer_evidencia."),
    esquema=esquema({"accion": {"type": "string", "enum": ["activar", "desactivar"]},
                     "auditoria": {"type": "string", "description": "Id o código (AUD-2026-003) del informe destino."}},
                    ["accion"]),
    fn=_modo, permisos=(P_AUD,)))


# ------------------------------------------------------------------ sugerir el modo auditor
async def _sugerir(ctx: Ctx, e: dict[str, Any]) -> Any:
    """El usuario aceptó en la tarjeta: se activa el modo (con el informe destino, si Voi propuso uno)."""
    conv = await _conv(ctx)
    try:
        inv = await investigacion.activar(ctx.db, conv, ctx.user, e.get("auditoria"), por="voi")
    except ValueError:
        inv = await investigacion.activar(ctx.db, conv, ctx.user, None, por="voi")   # el informe no sirve: sin destino
    _publicar(ctx, inv)
    return {
        "modo_auditor": "activo", "mensaje": "Modo auditor activado.",
        "informe_destino": ({"codigo": inv["codigo"], "titulo": inv["titulo"]} if inv.get("auditoria_id") else None),
        "indicaciones": ("Seguí con la investigación con postura de auditor: buscá alertas por tu cuenta y, si no hay "
                         "informe destino, preguntá a cuál va la evidencia o ofrecé prepararlo."),
    }


async def _resumen_sugerir(ctx: Ctx, e: dict[str, Any]) -> str:
    motivo = str(e.get("motivo") or "").strip()[:300]
    return f"Activar el modo auditor{': ' + motivo if motivo else ''}"


def _tarjeta_sugerir(entrada: dict[str, Any]) -> dict[str, Any]:
    return {"tipo": "modo_auditor", "motivo": str(entrada.get("motivo") or "").strip()[:300] or None,
            "auditoria": str(entrada.get("auditoria") or "").strip()[:40] or None}


registrar(Herramienta(
    nombre="proponer_modo_auditor", etiqueta="Sugiriendo el modo auditor", nivel=CONFIRMAR,
    descripcion=("Le pregunta al usuario si quiere activar el MODO AUDITOR (le aparece una tarjeta con «Activar» y "
                 "«Ahora no»). Usala, antes de responder, cuando el modo está apagado y el usuario está investigando: "
                 "alertas, vendedores en riesgo, líneas sin uso, ventas o cargas dudosas, auditorías o hallazgos. "
                 "`motivo`: en una frase, por qué conviene (lo ve el usuario). `auditoria`: el informe destino si ya "
                 "sabés cuál (id o código). Si lo rechaza, seguí normal y no insistas en la misma conversación."),
    esquema=esquema({"motivo": {"type": "string", "description": "Por qué conviene activarlo, en una frase."},
                     "auditoria": {"type": "string", "description": "Opcional: id o código del informe destino."}},
                    ["motivo"]),
    fn=_sugerir, resumen=_resumen_sugerir, tarjeta=_tarjeta_sugerir, permisos=(P_AUD,)))


# ------------------------------------------------------------------ proponer evidencia
def _piezas(e: dict[str, Any]) -> list[dict[str, Any]]:
    piezas = e.get("piezas")
    if not isinstance(piezas, list) or not piezas:
        raise ErrorHerramienta("Indicá las piezas del lienzo (artefacto_id) que proponés sumar al informe.")
    salida, vistas = [], set()
    for p in piezas[:MAX_PIEZAS]:
        if not isinstance(p, dict) or not p.get("artefacto_id"):
            raise ErrorHerramienta("Cada pieza necesita su artefacto_id (lo devuelve mostrar_en_lienzo).")
        widget = p.get("widget")
        widget = int(widget) if isinstance(widget, (int, float)) and not isinstance(widget, bool) else None
        clave = investigacion.clave(str(p["artefacto_id"])[:36], widget)
        if clave in vistas:
            continue
        vistas.add(clave)
        salida.append({"clave": clave, "artefacto_id": str(p["artefacto_id"])[:36], "widget": widget,
                       "titulo": str(p.get("titulo") or "").strip()[:255] or None,
                       "nota": str(p.get("nota") or "").strip()[:4000] or None})
    return salida


async def _informe_destino(ctx: Ctx, e: dict[str, Any]):
    conv = await _conv(ctx)
    inv = investigacion.estado(conv) or {}
    a = await investigacion.informe(ctx.db, e.get("auditoria") or inv.get("auditoria_id"))
    if a is None:
        raise ErrorHerramienta("No hay informe destino: preguntale al usuario a qué informe va (o preparalo con "
                               "preparar_auditoria) y activá el modo auditor con él.")
    return a


async def _proponer(ctx: Ctx, e: dict[str, Any]) -> Any:
    a = await _informe_destino(ctx, e)
    hallazgo_id = None
    if e.get("hallazgo"):
        from sqlalchemy import or_, select

        from ...operativas.televentas_claro.auditoria.models import AuditoriaHallazgo
        v = str(e["hallazgo"]).strip()
        h = (await ctx.db.execute(select(AuditoriaHallazgo).where(
            AuditoriaHallazgo.auditoria_id == a.id,
            or_(AuditoriaHallazgo.id == v[:36], AuditoriaHallazgo.codigo == v.upper()[:10])))).scalars().first()
        if h is None:
            raise ErrorHerramienta(f"El hallazgo {v} no es del informe {a.codigo}.")
        hallazgo_id = h.id
    agregadas, repetidas = [], []
    try:
        for p in _piezas(e):
            v = await investigacion.pieza(ctx.db, ctx.user, artefacto_id=p["artefacto_id"], widget=p["widget"])
            ev, nueva = await evidencias.crear_grafico(
                ctx.db, a, v["spec"], user_id=ctx.user.id, titulo=p["titulo"], nota=p["nota"], hallazgo_id=hallazgo_id,
                origen="voi", conversacion_id=v["conversacion_id"], artefacto_id=v["artefacto_id"])
            (agregadas if nueva else repetidas).append(ev)
    except (ValueError, evidencias.EvidenciaError) as exc:
        raise ErrorHerramienta(str(exc)) from exc
    await ctx.db.flush()
    todas = await evidencias.listar(ctx.db, a.id)
    numero = {x.id: i + 1 for i, x in enumerate(todas)}
    figuras = " y ".join(", ".join(f"Fig. {numero.get(x.id)}" for x in agregadas).rsplit(", ", 1))
    n = len(agregadas)
    mensaje = (f"{'Se sumó' if n == 1 else f'Se sumaron {n}'} al informe {a.codigo} como {figuras}." if n else
               f"Ya estaban en el informe {a.codigo}: no se duplicaron.")
    return {
        "mensaje": mensaje,
        "informe": a.codigo, "agregadas": [{"figura": numero.get(x.id), "titulo": x.titulo} for x in agregadas],
        "ya_estaban": [{"figura": numero.get(x.id), "titulo": x.titulo} for x in repetidas] or None,
        "total_figuras": len(todas), "pantalla": f"/televentas-claro/auditoria/informes/{a.id}#evidencia",
        "importante": "Sumá solo lo que el usuario eligió en la tarjeta. Contale qué figuras quedaron y con qué número.",
    }


async def _resumen(ctx: Ctx, e: dict[str, Any]) -> str:
    try:
        a = await _informe_destino(ctx, e)
        destino = f" al informe {a.codigo}"
    except ErrorHerramienta:
        destino = " al informe de auditoría"
    try:
        piezas = _piezas(e)
    except ErrorHerramienta:
        piezas = []
    titulos = ", ".join(f"«{p['titulo']}»" for p in piezas if p.get("titulo"))
    n = len(piezas)
    return (f"Sumar {n} pieza{'s' if n != 1 else ''} del lienzo{destino}" + (f": {titulos}" if titulos else "") +
            ". Elegí cuáles van.")


def _tarjeta(entrada: dict[str, Any]) -> dict[str, Any]:
    try:
        piezas = _piezas(entrada)
    except ErrorHerramienta:
        piezas = []
    return {"tipo": "evidencia", "piezas": piezas, "hallazgo": entrada.get("hallazgo")}


def _ajustar(entrada: dict[str, Any], ajustes: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Lo que el usuario eligió en la tarjeta: un subconjunto de lo propuesto, con título y nota retocados."""
    propuestas = {p["clave"]: p for p in _piezas(entrada)}
    seleccion = ajustes.get("seleccion")
    if not isinstance(seleccion, list):
        raise ErrorHerramienta("Elegí las piezas en la tarjeta.")
    if any(str(c) not in propuestas for c in seleccion):
        raise ErrorHerramienta("Solo se pueden elegir piezas de las propuestas.")
    ediciones = ajustes.get("ediciones") if isinstance(ajustes.get("ediciones"), dict) else {}
    elegidas = []
    for c in dict.fromkeys(str(c) for c in seleccion):
        p = dict(propuestas[c])
        ed = ediciones.get(c) if isinstance(ediciones.get(c), dict) else {}
        if isinstance(ed.get("titulo"), str) and ed["titulo"].strip():
            p["titulo"] = ed["titulo"].strip()[:255]
        if isinstance(ed.get("nota"), str):
            p["nota"] = ed["nota"].strip()[:4000] or None
        elegidas.append({k: p[k] for k in ("artefacto_id", "widget", "titulo", "nota")})
    if not elegidas:
        return None
    return {**entrada, "piezas": elegidas}


registrar(Herramienta(
    nombre="proponer_evidencia", etiqueta="Proponiendo evidencia para el informe", nivel=CONFIRMAR,
    descripcion=("Propone sumar piezas del lienzo (las que mostraste con mostrar_en_lienzo, por su artefacto_id; de un "
                 "tablero podés proponer partes con `widget`) como figuras del informe de auditoría destino. El usuario "
                 "ve una tarjeta con cada pieza, elige cuáles van, puede retocar título y nota, y confirma: se suman "
                 "solo las elegidas, numeradas. En modo auditor, usala cada vez que muestres algo en el lienzo. Sugerí "
                 "un título que sea la conclusión y una nota con la lectura del auditor; si la pieza respalda un "
                 "hallazgo, indicá su código en `hallazgo` (H-01…)."),
    esquema=esquema({
        "piezas": {"type": "array", "minItems": 1, "maxItems": MAX_PIEZAS, "items": {
            "type": "object", "additionalProperties": False,
            "properties": {"artefacto_id": {"type": "string"},
                           "widget": {"type": "integer", "minimum": 0, "description": "Parte de un tablero (opcional)."},
                           "titulo": {"type": "string", "description": "La conclusión que muestra la figura."},
                           "nota": {"type": "string", "description": "Lectura del auditor (opcional)."}},
            "required": ["artefacto_id"]}},
        "auditoria": {"type": "string", "description": "Opcional: otro informe (id o código). Por defecto, el destino."},
        "hallazgo": {"type": "string", "description": "Opcional: código del hallazgo que respaldan (H-02)."},
    }, ["piezas"]),
    fn=_proponer, resumen=_resumen, tarjeta=_tarjeta, ajustar=_ajustar, permisos=(P_AUD,)))
