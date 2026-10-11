"""Voi como guía de toda la plataforma: abre pantallas, guía paso a paso y ofrece opciones con botones.

- `abrir_pantalla`: navega el navegador del usuario a una pantalla (y resalta un botón o una zona). Solo a las que
  puede ver; si no puede, dice qué utilidad le falta.
- `guiar`: abre la pantalla donde se hace una tarea y muestra una guía flotante paso a paso (Anterior · Siguiente ·
  Listo) que resalta en la pantalla dónde tocar.
- `ofrecer_opciones`: pone en el chat una pregunta con 2 a 4 botones; el usuario elige con un toque y lo elegido se
  envía como si lo hubiera escrito (y, si la opción trae una ruta, abre esa pantalla).

Ninguna cambia datos: corren solas (nivel 1). Lo que afecta a otros sigue pasando por su tarjeta de confirmación.
"""
from __future__ import annotations

from typing import Any, Optional

from .. import pantallas as cat
from ...api.deps import CurrentUser
from .base import CONSULTAR, Ctx, ErrorHerramienta, Herramienta, esquema, registrar, texto

TODOS = frozenset({"superadmin", "gestion", "auditor"})
MAX_OPCIONES, MIN_OPCIONES = 4, 2


def _publicar(ctx: Ctx, evento: dict[str, Any]) -> None:
    ctx.extra.setdefault("publicar", []).append({**evento, "id": ctx.extra.get("evento_id")})


def _lista(user: CurrentUser, maximo: int = 40) -> str:
    return "; ".join(f"{p.titulo} ({p.ruta})" for p in cat.visibles(user)[:maximo])


def _sin_permiso(p: cat.Pantalla) -> str:
    """Lo que ve el usuario (y lee el modelo) cuando no puede abrir una pantalla: qué le falta y quién lo asigna."""
    return f"No se puede abrir «{p.titulo}»: {cat.falta(p)}. La asigna el superadmin en Administración → Perfiles."


# ------------------------------------------------------------------ abrir una pantalla
def resolver_destino(user: CurrentUser, ruta: str | None, pantalla: str | None) -> tuple[cat.Pantalla, str]:
    """La pantalla del catálogo y la ruta final (una ruta exacta puede traer id, pestaña o filtros)."""
    if ruta:
        limpia = cat.ruta_limpia(ruta)
        if limpia is None:
            raise ErrorHerramienta("La ruta tiene que ser interna, como /televentas-claro/ventas-netas (sin dominio).")
        p = cat.pantalla_de_ruta(limpia)
        if p is None:
            raise ErrorHerramienta("Esa ruta no es una pantalla de la plataforma. Las que el usuario puede abrir: " + _lista(user))
        if not cat.puede(user, p.permisos, p.solo_superadmin):
            raise ErrorHerramienta(_sin_permiso(p))
        return p, limpia
    if pantalla:
        p, oculta = cat.buscar_pantalla(user, pantalla)
        if p is None and oculta is not None:
            raise ErrorHerramienta(_sin_permiso(oculta))
        if p is None:
            raise ErrorHerramienta("No encontré esa pantalla. Las que el usuario puede abrir: " + _lista(user))
        return p, p.ruta
    raise ErrorHerramienta("Indicá «pantalla» (cómo la nombra el usuario o la tarea) o «ruta» (una ruta exacta que devolvió "
                           "otra herramienta).")


async def _abrir(ctx: Ctx, a: dict[str, Any]) -> Any:
    p, ruta = resolver_destino(ctx.user, str(a.get("ruta") or "").strip() or None, str(a.get("pantalla") or "").strip() or None)
    resaltar = str(a.get("resaltar") or "").strip()[:40] or None
    avisos: list[str] = []
    if resaltar and resaltar not in p.anclas:
        avisos.append(f"«{resaltar}» no es algo que se pueda resaltar en esa pantalla" +
                      (f" (se puede: {', '.join(p.anclas)})." if p.anclas else "."))
        resaltar = None
    motivo = str(a.get("motivo") or "").strip()[:200] or None
    _publicar(ctx, {"tipo": "navegar", "ruta": ruta, "titulo": p.titulo, "resaltar": resaltar, "motivo": motivo})
    guias = [g.titulo for g in cat.guias_visibles(ctx.user) if g.ruta == p.ruta]
    return {"ok": True, "ruta": ruta, "titulo": p.titulo, "que_hace": p.que_hace, "resaltado": resaltar,
            "guias_de_esta_pantalla": guias or None, "avisos": avisos or None,
            "mostrado": ("La pantalla ya se abrió en el navegador del usuario. Decile en una línea qué va a ver y qué "
                         "hacer ahí; no repitas el enlace.")}


registrar(Herramienta(
    nombre="abrir_pantalla", etiqueta="Abriendo una pantalla", nivel=CONSULTAR, modos=TODOS, guardar_resultado=True,
    descripcion=("ABRE en el navegador del usuario una pantalla de la plataforma (navega por él) y, si lo indicás, le "
                 "resalta el botón o la zona donde tiene que actuar. Usala cuando pida ir a algún lado («llevame a», "
                 "«abrí», «dónde está»), cuando le expliques algo que se hace en otra pantalla, o cuando termines una "
                 "acción cuyo resultado conviene ver. Pasá «pantalla» con el nombre o la tarea tal como la dice "
                 "(«subir corte de ventas», «centro de comandos», «mi perfil») o «ruta» exacta si la devolvió otra "
                 "herramienta (puede traer id o pestaña). Solo abre lo que el usuario puede ver: si no puede, te dice qué "
                 "utilidad le falta y vos se lo explicás. No abras más de una pantalla por turno ni sin motivo."),
    esquema=esquema({
        "pantalla": {"type": "string", "description": "Nombre o tarea, con las palabras del usuario."},
        "ruta": {"type": "string", "description": "Ruta exacta (/televentas-claro/…), si la devolvió otra herramienta."},
        "resaltar": {"type": "string", "description": "Qué resaltar al llegar: archivo, procesar, publicar, calcular, "
                                                      "preparar, enviar, crear, subir, objetivos, asignar, vincular, foto…"},
        "motivo": {"type": "string", "description": "Para qué la abrís, en una frase corta (lo ve el usuario)."},
    }),
    fn=_abrir))


# ------------------------------------------------------------------ guiar paso a paso
async def _guiar(ctx: Ctx, a: dict[str, Any]) -> Any:
    tarea = texto(a.get("tarea"), "la tarea", minimo=3, maximo=300)
    g, oculta = cat.buscar_guia(ctx.user, tarea)
    if g is None and oculta is not None:
        raise ErrorHerramienta(f"Hay una guía para «{oculta.titulo}», pero para esa tarea {cat.falta(oculta)}. La asigna el "
                               "superadmin en Administración → Perfiles.")
    if g is None:
        disponibles = "; ".join(f"{x.titulo} ({x.clave})" for x in cat.guias_visibles(ctx.user))
        raise ErrorHerramienta("No tengo una guía paso a paso para eso. Las que hay para este usuario: " + disponibles +
                               ". Si ninguna sirve, explicáselo vos en pocos pasos y abrile la pantalla con abrir_pantalla.")
    guia = cat.guia_dict(g)
    _publicar(ctx, {"tipo": "guia", "guia": guia})
    return {"ok": True, "guia": guia,
            "mostrado": ("La guía flotante ya está en la pantalla del usuario: lo llevó a la pantalla y le marca dónde "
                         "tocar en cada paso. En el chat decile en dos líneas qué va a hacer (sin repetir todos los pasos) "
                         "y, si vos podés hacer una parte con tus herramientas, ofrecelo.")}


registrar(Herramienta(
    nombre="guiar", etiqueta="Preparando una guía paso a paso", nivel=CONSULTAR, modos=TODOS, guardar_resultado=True,
    descripcion=("GUÍA al usuario paso a paso en una tarea de la plataforma: abre la pantalla donde se hace y le muestra "
                 "una guía flotante con los pasos de a uno (Siguiente · Listo), resaltando en la pantalla dónde tocar. "
                 "Usala cuando pregunte cómo se hace algo («cómo subo…», «no sé cómo…», «ayudame a…», «guiame») o cuando "
                 "lo notes perdido. Pasá «tarea» con lo que quiere hacer, con sus palabras; la plataforma elige la guía "
                 "(subir el corte de ventas, subir cortes de llamadas, publicar, calcular el SPH, preparar y firmar el "
                 "informe diario, enviar un ticket, trabajar alertas, crear un informe de auditoría, subir evidencia, armar "
                 "equipos, cargar objetivos, vincular operadores, subir una liquidación, cambiar la foto o la contraseña, "
                 "subir un documento a tu base de conocimiento). Subir archivos lo hace siempre el usuario: la guía le "
                 "marca dónde elegirlos y qué pasa después."),
    esquema=esquema({"tarea": {"type": "string", "description": "Qué quiere hacer, con las palabras del usuario."}}, ["tarea"]),
    fn=_guiar))


# ------------------------------------------------------------------ ofrecer opciones con botones
def normalizar_opciones(entrada: dict[str, Any], user: Optional[CurrentUser] = None) -> dict[str, Any]:
    """Valida la pregunta y las opciones. Con `user`, una ruta que no puede abrir se descarta (queda el mensaje)."""
    pregunta = texto(entrada.get("pregunta"), "la pregunta", minimo=3, maximo=200)
    crudas = entrada.get("opciones")
    if not isinstance(crudas, list):
        raise ErrorHerramienta(f"Pasá «opciones»: una lista de {MIN_OPCIONES} a {MAX_OPCIONES} botones con «texto».")
    opciones: list[dict[str, Any]] = []
    vistos: set[str] = set()
    for o in crudas:
        if len(opciones) == MAX_OPCIONES:
            break
        if isinstance(o, str):
            o = {"texto": o}
        if not isinstance(o, dict):
            continue
        t = str(o.get("texto") or "").strip()[:60]
        if not t or t.lower() in vistos:
            continue
        vistos.add(t.lower())
        op: dict[str, Any] = {"texto": t, "mensaje": (str(o.get("mensaje") or "").strip()[:300] or t)}
        ruta = cat.ruta_limpia(str(o.get("ruta") or "")) if o.get("ruta") else None
        if ruta:
            p = cat.pantalla_de_ruta(ruta)
            if p is not None and (user is None or cat.puede(user, p.permisos, p.solo_superadmin)):
                op["ruta"], op["titulo"] = ruta, p.titulo
        opciones.append(op)
    if len(opciones) < MIN_OPCIONES:
        raise ErrorHerramienta(f"Hacen falta al menos {MIN_OPCIONES} opciones distintas con «texto» (hasta {MAX_OPCIONES}).")
    return {"pregunta": pregunta, "opciones": opciones}


async def _ofrecer(ctx: Ctx, a: dict[str, Any]) -> Any:
    d = normalizar_opciones(a, ctx.user)
    _publicar(ctx, {"tipo": "opciones", **d})
    return {"ok": True, **d,
            "mostrado": ("Los botones ya están en el chat. Cerrá tu respuesta en una línea, sin repetir las opciones, y "
                         "esperá la elección: te llega como un mensaje del usuario.")}


registrar(Herramienta(
    nombre="ofrecer_opciones", etiqueta="Ofreciendo opciones", nivel=CONSULTAR, modos=TODOS,
    descripcion=("Muestra en el chat una pregunta con 2 a 4 BOTONES para que el usuario elija con un toque en vez de "
                 "escribir. Usala para aprobar un paso puntual («¿Lo preparo?» → «Sí, preparalo» / «Mejor llevame a la "
                 "pantalla»), para elegir un camino (por dónde seguir, qué mes, qué módulo) y cuando no sepa qué hacer "
                 "(ofrecé las 3 cosas más útiles para su perfil y la pantalla en la que está). Cada opción tiene «texto» "
                 "(lo que dice el botón, corto) y, si hace falta, «mensaje» (lo que se envía como si lo hubiera escrito; "
                 "por defecto el texto) o «ruta» (además abre esa pantalla). Las acciones que afectan a otros siguen "
                 "pidiendo su propia confirmación. Después de llamarla, terminá tu respuesta y esperá la elección."),
    esquema=esquema({
        "pregunta": {"type": "string", "description": "La pregunta, corta."},
        "opciones": {"type": "array", "minItems": MIN_OPCIONES, "maxItems": MAX_OPCIONES, "items": {
            "type": "object", "additionalProperties": False,
            "properties": {"texto": {"type": "string", "description": "Lo que dice el botón (hasta 60 caracteres)."},
                           "mensaje": {"type": "string", "description": "Lo que se envía al elegirla (por defecto, el texto)."},
                           "ruta": {"type": "string", "description": "Pantalla que se abre además (ruta interna)."}},
            "required": ["texto"]}},
    }, ["pregunta", "opciones"]),
    fn=_ofrecer))
