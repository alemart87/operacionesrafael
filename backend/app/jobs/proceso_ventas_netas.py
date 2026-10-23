"""Lo que corre dentro del subproceso aislado de Ventas Netas: leer el .xlsx, analizarlo y comprimir los datos leídos.

Va fuera de `app.operativas` a propósito: el subproceso se crea con 'spawn' (memoria limpia) y tiene que importar el
módulo de la función que corre. Si fuera `app.operativas....jobs`, importaría todas las operativas (más de mil
módulos, ~110 MB) solo para leer una planilla; acá carga únicamente `parser.py` y `analyzer.py` (lógica pura, sin
base de datos ni red) desde su archivo, más openpyxl.

Devuelve al servidor solo lo que guarda: los datos leídos ya comprimidos (`parsed_gz`, menos de 1 MB para un corte de
20.000 cargas) y el análisis. Antes volvía la lista entera de filas (~16 MB en el pickle y cientos de MB al
reconstruirla en el proceso del servidor), que con un corte grande se sumaba al subproceso y pasaba el límite de
memoria de la instancia: Render reiniciaba todo el servicio y el corte quedaba «interrumpido».
"""
from __future__ import annotations

import gzip
import importlib.util
import io
import json
from pathlib import Path
from types import ModuleType
from typing import Any

_CARPETA = Path(__file__).resolve().parents[1] / "operativas" / "televentas_claro" / "ventas_netas"
_MODULOS: dict[str, ModuleType] = {}


def _cargar(nombre: str) -> ModuleType:
    """`parser` o `analyzer` de Ventas Netas, cargados desde su archivo (sin importar el paquete de las operativas)."""
    if nombre not in _MODULOS:
        spec = importlib.util.spec_from_file_location(f"_ventas_netas_{nombre}", _CARPETA / f"{nombre}.py")
        modulo = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(modulo)          # type: ignore[union-attr]
        _MODULOS[nombre] = modulo
    return _MODULOS[nombre]


def comprimir(parsed: dict[str, Any]) -> bytes:
    """Los datos leídos en JSON comprimido, escritos de a partes (sin armar antes todo el texto en memoria)."""
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb") as gz, io.TextIOWrapper(gz, encoding="utf-8") as texto:
        json.dump(parsed, texto, ensure_ascii=False, separators=(",", ":"))
    return buf.getvalue()


def _sin_clases_propias(exc: Exception) -> Exception:
    """Las excepciones de los módulos cargados desde su archivo no se pueden reconstruir del otro lado: vuelven como
    ValueError con el mismo mensaje (el servidor solo muestra el mensaje). Las de Python viajan tal cual."""
    return exc if type(exc).__module__ == "builtins" else ValueError(str(exc) or type(exc).__name__)


def analizar_comprimido(parsed_gz: bytes) -> dict[str, Any]:
    """Recalcula el análisis desde los datos leídos guardados (sin el archivo), también fuera del servidor: con un
    corte grande, descomprimir las filas en el proceso del servidor pesa cientos de MB."""
    try:
        return _cargar("analyzer").analyze_ventas_netas(json.loads(gzip.decompress(parsed_gz).decode("utf-8")))
    except Exception as exc:  # noqa: BLE001
        raise _sin_clases_propias(exc) from None


def procesar(path: str) -> dict[str, Any]:
    """Lee y analiza el corte. Devuelve {"parsed_gz": bytes, "analysis": dict}.

    Un error del archivo (p. ej. ArchivoInvalido del parser) vuelve como ValueError con el mismo mensaje."""
    try:
        parsed = _cargar("parser").parse_ventas_netas(path)
        analysis = _cargar("analyzer").analyze_ventas_netas(parsed)
        return {"parsed_gz": comprimir(parsed), "analysis": analysis}
    except Exception as exc:  # noqa: BLE001
        raise _sin_clases_propias(exc) from None
