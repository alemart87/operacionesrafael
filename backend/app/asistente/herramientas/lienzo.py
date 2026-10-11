"""El lienzo de Voi: gráficos, indicadores, tablas y tableros que el usuario ve al lado del chat.

El agente consulta los datos con las otras herramientas y acá arma la visualización con una especificación simple
(tipo, título, datos, eje, series, formato). La plataforma la valida y la normaliza (si algo no cierra, devuelve un
error que el modelo entiende y corrige), la guarda en la conversación y el navegador la dibuja con la paleta de marca
validada (incluye la tabla de datos y la descarga). Mostrar no cambia datos: corre sola.
"""
from __future__ import annotations

import json
import math
from typing import Any

from ..models import AsistenteArtefacto
from .base import CONSULTAR, Ctx, ErrorHerramienta, Herramienta, esquema, registrar

TIPOS = ("kpis", "barras", "columnas", "lineas", "area", "apiladas", "dona", "tabla", "tablero")
FORMATOS = ("numero", "decimal", "porcentaje", "guaranies", "dolares")
MAX_SERIES, MAX_WIDGETS, MAX_KPIS, MAX_PARTES = 6, 8, 8, 6
MAX_FILAS = {"barras": 60, "columnas": 40, "apiladas": 40, "lineas": 400, "area": 400, "dona": 40, "tabla": 500}
MAX_BYTES = 250_000


def _num(v: Any) -> float | None:
    """Acepta números o textos numéricos («1.234,5», «12,4 %», «Gs. 1.000»); lo demás queda vacío."""
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return None if (isinstance(v, float) and (math.isnan(v) or math.isinf(v))) else float(v)
    if isinstance(v, str):
        t = v.strip().replace("Gs.", "").replace("US$", "").replace("%", "").replace(" ", "")
        if not t:
            return None
        if "," in t and "." in t:
            t = t.replace(".", "").replace(",", ".")        # 1.234,5 → 1234.5
        elif "," in t:
            t = t.replace(",", ".")
        elif t.count(".") > 1 or (t.count(".") == 1 and len(t.split(".")[1]) == 3 and len(t.split(".")[0]) <= 3
                                   and t.replace(".", "").isdigit()):
            t = t.replace(".", "")                           # 1.234 (miles) → 1234
        try:
            return float(t)
        except ValueError:
            return None
    return None


def _texto(v: Any, n: int) -> str:
    return str(v if v is not None else "").strip()[:n]


def _formato(v: Any, defecto: str = "numero") -> str:
    return v if v in FORMATOS else defecto


def _filas(spec: dict[str, Any]) -> list[dict[str, Any]]:
    datos = spec.get("datos")
    if not isinstance(datos, list) or not datos:
        raise ErrorHerramienta("Faltan los datos: «datos» tiene que ser una lista de filas (objetos) con los valores ya "
                               "consultados.")
    filas = [d for d in datos if isinstance(d, dict)]
    if not filas:
        raise ErrorHerramienta("Cada fila de «datos» tiene que ser un objeto, por ejemplo {\"dia\": \"01/10\", \"ventas\": 63}.")
    return filas


def _campos(filas: list[dict[str, Any]]) -> list[str]:
    vistos: list[str] = []
    for f in filas[:50]:
        for k in f:
            if k not in vistos:
                vistos.append(k)
    return vistos


def _es_numerico(filas: list[dict[str, Any]], campo: str) -> bool:
    valores = [f.get(campo) for f in filas if f.get(campo) not in (None, "")]
    return bool(valores) and sum(_num(v) is not None for v in valores) >= max(1, int(len(valores) * 0.8))


def _kpis(spec: dict[str, Any]) -> list[dict[str, Any]]:
    kpis = spec.get("kpis")
    if not isinstance(kpis, list) or not kpis:
        raise ErrorHerramienta("Para «kpis» pasá la lista «kpis» con {titulo, valor, formato, detalle, variacion, bueno_si}.")
    out = []
    for k in kpis[:MAX_KPIS]:
        if not isinstance(k, dict) or not _texto(k.get("titulo"), 60):
            raise ErrorHerramienta("Cada indicador necesita «titulo» y «valor».")
        variacion = _num(k.get("variacion"))
        out.append({"titulo": _texto(k.get("titulo"), 60), "valor": _num(k.get("valor")),
                    "formato": _formato(k.get("formato"), _formato(spec.get("formato"))),
                    "detalle": _texto(k.get("detalle"), 140) or None,
                    "variacion": None if variacion is None else round(variacion, 1),
                    "bueno_si": k.get("bueno_si") if k.get("bueno_si") in ("sube", "baja") else "sube"})
    return out


def normalizar(spec: Any, *, anidado: bool = False) -> tuple[dict[str, Any], list[str]]:
    """Valida y normaliza una visualización. Devuelve (spec, avisos) o levanta ErrorHerramienta con qué corregir."""
    if not isinstance(spec, dict):
        raise ErrorHerramienta("La visualización tiene que ser un objeto con «tipo» y «titulo».")
    tipo = spec.get("tipo")
    if tipo not in TIPOS or (anidado and tipo == "tablero"):
        validos = [t for t in TIPOS if not (anidado and t == "tablero")]
        raise ErrorHerramienta(f"«tipo» inválido ({tipo!r}). Usá uno de: {', '.join(validos)}.")
    titulo = _texto(spec.get("titulo"), 120)
    if len(titulo) < 3:
        raise ErrorHerramienta("Falta el «titulo»: una frase corta que diga la conclusión.")
    avisos: list[str] = []
    out: dict[str, Any] = {"tipo": tipo, "titulo": titulo, "descripcion": _texto(spec.get("descripcion"), 600) or None,
                           "nota": _texto(spec.get("nota"), 300) or None, "formato": _formato(spec.get("formato"))}
    if tipo == "kpis":
        out["kpis"] = _kpis(spec)
        return out, avisos
    if tipo == "tablero":
        widgets = spec.get("widgets")
        if not isinstance(widgets, list) or not widgets:
            raise ErrorHerramienta("Para «tablero» pasá «widgets»: una lista de visualizaciones (kpis, gráficos o tablas).")
        out["widgets"] = []
        for i, w in enumerate(widgets[:MAX_WIDGETS]):
            try:
                ws, wa = normalizar(w, anidado=True)
            except ErrorHerramienta as exc:
                raise ErrorHerramienta(f"widgets[{i}]: {exc}") from exc
            out["widgets"].append(ws)
            avisos += [f"widgets[{i}]: {a}" for a in wa]
        if len(widgets) > MAX_WIDGETS:
            avisos.append(f"Un tablero muestra hasta {MAX_WIDGETS} piezas: quedaron las primeras.")
        return out, avisos

    filas = _filas(spec)
    campos = _campos(filas)
    limite = MAX_FILAS[tipo]
    if len(filas) > limite:
        avisos.append(f"Se muestran las primeras {limite} filas de {len(filas)}" +
                      (": para más detalle usá «tabla»." if tipo != "tabla" else "."))
        filas = filas[:limite]

    if tipo == "tabla":
        cols_in = spec.get("columnas") if isinstance(spec.get("columnas"), list) and spec.get("columnas") else \
            [{"campo": c} for c in campos]
        columnas = []
        for c in cols_in[:20]:
            campo = c.get("campo") if isinstance(c, dict) else c
            if campo not in campos:
                raise ErrorHerramienta(f"La columna {campo!r} no está en los datos (hay: {', '.join(campos[:15])}).")
            numerica = _es_numerico(filas, campo)
            columnas.append({"campo": campo, "nombre": _texto((c.get("nombre") if isinstance(c, dict) else None) or campo, 60),
                             "formato": _formato(c.get("formato") if isinstance(c, dict) else None, out["formato"])
                             if numerica else "texto"})
        out["columnas"] = columnas
        out["datos"] = [{c["campo"]: (_num(f.get(c["campo"])) if c["formato"] != "texto" else _texto(f.get(c["campo"]), 200))
                         for c in columnas} for f in filas]
        return out, avisos

    x = spec.get("x") or next((c for c in campos if not _es_numerico(filas, c)), None)
    if not x or x not in campos:
        raise ErrorHerramienta(f"Indicá «x»: el campo de las categorías o fechas (hay: {', '.join(campos[:15])}).")
    series_in = spec.get("series") if isinstance(spec.get("series"), list) and spec.get("series") else \
        [{"campo": c} for c in campos if c != x and _es_numerico(filas, c)]
    if not series_in:
        raise ErrorHerramienta("No hay valores numéricos para graficar: indicá «series» con los campos numéricos.")
    series = []
    for s in series_in:
        campo = s.get("campo") if isinstance(s, dict) else s
        if campo not in campos:
            raise ErrorHerramienta(f"La serie {campo!r} no está en los datos (hay: {', '.join(campos[:15])}).")
        if not _es_numerico(filas, campo):
            raise ErrorHerramienta(f"La serie {campo!r} no tiene números: pasá los valores como números.")
        series.append({"campo": campo, "nombre": _texto((s.get("nombre") if isinstance(s, dict) else None) or campo, 60)})
    if len(series) > MAX_SERIES:
        avisos.append(f"Se muestran {MAX_SERIES} series de {len(series)}: más colores no se distinguen (usá una tabla o "
                      "varios gráficos).")
        series = series[:MAX_SERIES]
    if tipo == "dona" and len(series) > 1:
        avisos.append("La dona muestra una sola serie: quedó la primera.")
        series = series[:1]
    datos = [{x: _texto(f.get(x), 80), **{s["campo"]: _num(f.get(s["campo"])) for s in series}} for f in filas]
    if tipo == "dona":
        campo = series[0]["campo"]
        if any((d[campo] or 0) < 0 for d in datos):
            raise ErrorHerramienta("Una dona no admite valores negativos: usá barras.")
        datos.sort(key=lambda d: -(d[campo] or 0))
        if len(datos) > MAX_PARTES:
            otros = sum(d[campo] or 0 for d in datos[MAX_PARTES - 1:])
            avisos.append(f"La dona muestra {MAX_PARTES} partes: el resto quedó en «Otros».")
            datos = datos[:MAX_PARTES - 1] + [{x: "Otros", campo: otros}]
    if tipo == "barras" and spec.get("orden") in ("desc", "asc") and len(series) == 1:
        campo = series[0]["campo"]
        datos.sort(key=lambda d: (d[campo] is None, -(d[campo] or 0) if spec["orden"] == "desc" else (d[campo] or 0)))
    out.update({"x": x, "series": series, "datos": datos})
    if _texto(spec.get("x_nombre"), 60):
        out["x_nombre"] = _texto(spec.get("x_nombre"), 60)
    destacar = _texto(spec.get("destacar"), 80)
    if destacar:
        if destacar not in {d[x] for d in datos}:
            avisos.append(f"«destacar» ({destacar}) no coincide con ninguna categoría: se ignoró.")
        else:
            out["destacar"] = destacar
    meta = _num(spec.get("meta"))
    if meta is not None and tipo in ("barras", "columnas", "lineas", "area"):
        out["meta"] = meta
        out["meta_nombre"] = _texto(spec.get("meta_nombre"), 40) or "Meta"
    return out, avisos


async def _mostrar(ctx: Ctx, a: dict[str, Any]) -> Any:
    spec, avisos = normalizar(a)
    if len(json.dumps(spec, ensure_ascii=False, default=str)) > MAX_BYTES:
        raise ErrorHerramienta("La visualización es demasiado grande: resumí los datos (agrupá o mostrá los principales).")
    art = AsistenteArtefacto(conversacion_id=ctx.conversacion_id, user_id=ctx.user.id, tipo=spec["tipo"],
                             titulo=spec["titulo"], spec=spec, evento_id=ctx.extra.get("evento_id"))
    ctx.db.add(art)
    await ctx.db.flush()
    ctx.extra.setdefault("publicar", []).append({"tipo": "lienzo", "artefacto": artefacto_dict(art)})
    return {"ok": True, "artefacto_id": art.id, "avisos": avisos or None,
            "mostrado": (f"«{spec['titulo']}» quedó en el lienzo, al lado del chat. En la respuesta contá la lectura "
                         "principal en 1 a 3 líneas; no repitas los datos que ya se ven.")}


def artefacto_dict(a: AsistenteArtefacto) -> dict[str, Any]:
    return {"id": a.id, "tipo": a.tipo, "titulo": a.titulo, "spec": a.spec, "evento_id": a.evento_id,
            "created_at": a.created_at.isoformat() if a.created_at else None}


_FORMATO = {"type": "string", "enum": list(FORMATOS),
            "description": "numero (1.234), decimal (1.234,5), porcentaje (los valores ya vienen en %: 12.4 → 12,4 %), "
                           "guaranies (Gs. 1.234.567) o dolares (US$ 12,34)."}
_PIEZA = {
    "tipo": {"type": "string", "enum": list(TIPOS)},
    "titulo": {"type": "string", "description": "La conclusión en una frase corta («GPON creció 12 % en la semana»)."},
    "descripcion": {"type": "string", "description": "La lectura en una o dos frases (qué mirar y por qué importa)."},
    "nota": {"type": "string", "description": "Fuente y fecha de corte («Ventas Netas al 10/10»)."},
    "datos": {"type": "array", "items": {"type": "object"},
              "description": "Filas con los valores ya consultados, por ejemplo [{\"dia\": \"01/10\", \"pospago\": 42, \"gpon\": 19}]."},
    "x": {"type": "string", "description": "Campo de las categorías o fechas (eje horizontal o etiquetas)."},
    "x_nombre": {"type": "string", "description": "Cómo se llama ese campo para el usuario («Día», «Supervisor»)."},
    "series": {"type": "array", "maxItems": MAX_SERIES, "items": {
        "type": "object", "properties": {"campo": {"type": "string"}, "nombre": {"type": "string"}},
        "required": ["campo"]}, "description": "Campos numéricos a graficar con su nombre visible (máximo 6)."},
    "formato": _FORMATO,
    "destacar": {"type": "string", "description": "Categoría a resaltar (el resto queda en gris)."},
    "meta": {"type": "number", "description": "Línea de referencia (meta u objetivo)."},
    "meta_nombre": {"type": "string"},
    "orden": {"type": "string", "enum": ["desc", "asc"], "description": "Para barras de un ranking."},
    "columnas": {"type": "array", "items": {
        "type": "object", "properties": {"campo": {"type": "string"}, "nombre": {"type": "string"}, "formato": _FORMATO},
        "required": ["campo"]}, "description": "Para tabla: columnas en orden (por defecto, todas)."},
    "kpis": {"type": "array", "maxItems": MAX_KPIS, "items": {
        "type": "object", "properties": {
            "titulo": {"type": "string"}, "valor": {"type": "number"}, "formato": _FORMATO,
            "detalle": {"type": "string", "description": "Contexto: «de 1.170 de objetivo», «vs. semana anterior»."},
            "variacion": {"type": "number", "description": "Cambio en % contra el período que diga el detalle."},
            "bueno_si": {"type": "string", "enum": ["sube", "baja"]}},
        "required": ["titulo", "valor"]}},
}

registrar(Herramienta(
    nombre="mostrar_en_lienzo", etiqueta="Armando la visualización",
    descripcion=(
        "Muestra una visualización en el LIENZO, el panel grande que el usuario ve al lado del chat: gráficos (barras, "
        "columnas, lineas, area, apiladas, dona), indicadores (kpis), tablas largas o un tablero con varias piezas. "
        "Usala cuando haya que comparar, ver una tendencia, un ranking o una composición, cuando la respuesta tenga más "
        "de 8 filas, y siempre que pidan un gráfico, tablero o dashboard. Pasá solo datos ya consultados con las otras "
        "herramientas: nunca inventes valores. Forma: tendencia en el tiempo → lineas (area si es una sola serie); "
        "comparar categorías → barras (nombres largos o ranking) o columnas (pocas categorías cortas); una categoría que "
        "importa más → barras con «destacar»; composición → apiladas, o dona con hasta 6 partes; pocos números clave → "
        "kpis; mucho detalle → tabla; panorama → tablero con kpis y 1 a 3 gráficos. Hasta 6 series. Si la respuesta "
        "trae un aviso o un error, corregí y volvé a llamar."),
    esquema=esquema({**_PIEZA, "widgets": {"type": "array", "maxItems": MAX_WIDGETS, "items": {
        "type": "object", "properties": _PIEZA, "required": ["tipo", "titulo"]},
        "description": "Para tablero: las piezas (kpis, gráficos o tablas), en el orden en que se ven."}},
        ["tipo", "titulo"]),
    fn=_mostrar, nivel=CONSULTAR))
