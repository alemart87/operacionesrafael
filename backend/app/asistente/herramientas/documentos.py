"""La base de conocimiento como herramienta: Voi busca en los documentos que subió el superadmin y los cita.

Solo ve los documentos activos cuyo alcance incluye a quien conversa. La descripción de la herramienta se arma por
sesión con la lista de esos documentos; si no hay ninguno, la sesión no recibe la herramienta.
"""
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from ...api.deps import CurrentUser
from .. import conocimiento
from .base import CONSULTAR, Ctx, ErrorHerramienta, Herramienta, esquema, registrar, seleccionar, texto

DESCRIPCION = (
    "Busca en la base de conocimiento de la plataforma: manuales, políticas, procedimientos y criterios que subió el "
    "superadmin. Usala ANTES de responder cualquier pregunta sobre reglas, políticas, procesos, criterios, plazos, "
    "definiciones o «qué dice el manual / la política / el procedimiento». Devuelve los pasajes más relevantes, cada uno "
    "con su «cita» lista para copiar.\n"
    "Cómo responder con lo que encuentres: basate solo en los pasajes; poné la cita de cada pasaje que uses al final de "
    "la oración, copiada tal cual (formato [Título, p. N](cita:frag_…)): el usuario la toca y ve el texto exacto. Nunca "
    "inventes una cita ni cambies su identificador. Si los pasajes no responden la pregunta, decilo («no lo encontré en "
    "los documentos») en vez de completar con suposiciones.\n"
    "Cómo buscar: con palabras clave concretas («chargeback plazo», «cuota diferida GPON»), no con la pregunta entera. Si "
    "no aparece, probá una vez más con sinónimos o restringí a un documento con `documento_id`."
)


async def _preparar(db: AsyncSession, user: CurrentUser) -> Optional[str]:
    docs = await conocimiento.documentos_para(db, user)
    if not docs:
        return None
    return f"{DESCRIPCION}\n\nDocumentos que esta persona puede consultar (al empezar la conversación):\n" \
           f"{conocimiento.describir_catalogo(docs)}"


async def _buscar(ctx: Ctx, e: dict[str, Any]) -> Any:
    consulta = texto(e.get("consulta"), "la consulta", 2, 300)
    documento_id = (str(e.get("documento_id") or "").strip() or None)
    try:
        limite = max(1, min(int(e.get("max_resultados") or 6), conocimiento.MAX_RESULTADOS))
    except (TypeError, ValueError):
        limite = 6
    if not conocimiento.terminos(consulta):
        raise ErrorHerramienta("La consulta no tiene palabras clave: buscá con términos concretos (p. ej. «plazo "
                               "chargeback»).")
    resultados = await conocimiento.buscar(ctx.db, ctx.user, consulta, documento_id=documento_id, limite=limite)
    if resultados:
        return {"resultados": [seleccionar(r, ("cita", "documento", "pagina", "seccion", "texto", "terminos_encontrados"))
                               for r in resultados],
                "como_citar": "Copiá la «cita» de cada pasaje que uses, tal cual, al final de la oración."}
    docs = await conocimiento.documentos_para(ctx.db, ctx.user)
    if not docs:
        return {"resultados": [], "mensaje": "Esta persona no tiene documentos disponibles en la base de conocimiento."}
    if documento_id and documento_id not in {d.id for d in docs}:
        raise ErrorHerramienta("Ese documento no existe o no está al alcance de esta persona: buscá sin documento_id.")
    return {"resultados": [], "mensaje": "No encontré pasajes con esas palabras. Probá otras palabras clave una vez; si "
                                         "tampoco aparece, decile al usuario que no está en los documentos.",
            "documentos_disponibles": [d.titulo for d in docs[:20]]}


registrar(Herramienta(
    nombre="buscar_en_documentos", etiqueta="Buscando en los documentos", descripcion=DESCRIPCION,
    esquema=esquema({
        "consulta": {"type": "string", "description": "Palabras clave de lo que buscás (2 a 300 caracteres)."},
        "documento_id": {"type": "string", "description": "Opcional: buscar solo en este documento (su id de la lista)."},
        "max_resultados": {"type": "integer", "minimum": 1, "maximum": 10, "description": "Cuántos pasajes (6 por defecto)."},
    }, ["consulta"]),
    fn=_buscar, nivel=CONSULTAR, preparar=_preparar,
))
