"""Parser del archivo .xlsx de ventas que envía Claro (corte diario).

Formato: tres hojas — DDI (líneas activadas), CARGAS (ventas cargadas) y
PORTABILIDAD (Pospago con portación efectiva) — cada una con un título en la
fila 1, una fila vacía y los encabezados en la fila 3. Se busca la fila de
encabezados por su primera columna, así que tolera filas extra arriba.

Devuelve filas normalizadas (dicts con claves en minúsculas) con solo las
columnas que usa el análisis. Corre en subproceso aislado (ver jobs.py).
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Iterable

from openpyxl import load_workbook

# Hoja -> (nombre, primera columna del encabezado, obligatoria)
HOJAS = {
    "ddi": ("DDI", "FECHA_ACTIVACION", True),
    "cargas": ("CARGAS", "PERIODO_CARGA_VENTA", True),
    "portabilidad": ("PORTABILIDAD", "FECHA_ACTIVACION", False),
}

COLUMNAS = {
    "ddi": [
        "FECHA_ACTIVACION", "PERIODO_ACTIVACION", "TIPO_PRODUCTO", "PLAN_ID_ORIG", "PLAN_DESCRIPCION",
        "CAMPANIA", "PROMO_ID", "ACTIVACION_PORTACION", "PORTACION", "PORTACION_TIPO", "PORTACION_FECHA",
        "ORIGEN_PORTACION", "REGION", "DEPARTAMENTO", "CIUDAD", "CLIENTE_SEGMENTO", "SUBCANAL",
        "POS_ID", "POS_NOMBRE", "CONSUMO_DATOS", "SDS_NUMBER", "SDS_FORMULARIO", "LINEA_ORIG",
        "LINEA_ESTADO_CIERRE", "LINEA_RAZON_CIERRE", "VENTA", "TOTAL_PLAN", "TOTAL_DESCUENTO", "TOTAL_NETO",
    ],
    "cargas": [
        "PERIODO_CARGA_VENTA", "SDS_NUMBER", "SDS_FECHA_ALTA_VENTA", "SDS_FECHA_VENTA", "TIEMPO_ATENC_MIN",
        "SDS_ESTADO", "SDS_CANC_ADM", "SDS_FORMULARIO", "LINEA_ORIG", "TIPO_PRODUCTO", "PLAN_ID_ORIG",
        "PLAN_DESCRIPCION_ORIG", "CAMPANIA", "CAMPANIA_DESCRIPCION", "FECHA_ACTIVACION", "PERIODO_VENTA",
        "ORIGEN_PORTACION", "TIPO_PORT", "RIESGO_ORI", "DEPARTAMENTO_FACT", "CIUDAD_FACT",
        "VENDEDOR_LEGAJO", "VENDEDOR_NOMBRE", "VENDEDOR_APELLIDO", "POS_ID", "POS_NOMBRE", "SUBCANAL",
        "COMENTARIO", "FECHA_DATO",
    ],
    "portabilidad": [
        "FECHA_ACTIVACION", "TIPO_PRODUCTO", "PLAN_DESCRIPCION", "PORTACION_TIPO", "PORTACION_FECHA",
        "ORIGEN_PORTACION", "POS_NOMBRE", "SUBCANAL", "CONSUMO_DATOS", "SDS_NUMBER", "LINEA_ORIG",
        "LINEA_CIERRE", "LINEA_ESTADO_CIERRE", "LINEA_RAZON_CIERRE", "CIUDAD",
    ],
}


class ArchivoInvalido(ValueError):
    pass


def _norm(v: Any) -> Any:
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, str):
        v = v.strip()
        return v if v not in ("", "N/A") else None
    return v


def _find_header(rows: Iterable[tuple], primera: str, max_scan: int = 15) -> tuple[int, list[str]] | None:
    for i, row in enumerate(rows):
        if i >= max_scan:
            break
        first = row[0] if row else None
        if isinstance(first, str) and first.strip().upper() == primera:
            return i, [str(c).strip().upper() if c is not None else "" for c in row]
    return None


def _parse_sheet(ws, primera: str, columnas: list[str]) -> list[dict[str, Any]]:
    rows = ws.iter_rows(values_only=True)
    found = _find_header(rows, primera)
    if not found:
        raise ArchivoInvalido(
            f"La hoja '{ws.title}' no tiene la fila de encabezados esperada (debe empezar con {primera})."
        )
    _, header = found
    idx = {c: header.index(c) for c in columnas if c in header}
    faltan = [c for c in columnas if c not in idx]
    if "SDS_NUMBER" in faltan or "TIPO_PRODUCTO" in faltan:
        raise ArchivoInvalido(f"La hoja '{ws.title}' no tiene las columnas {', '.join(faltan[:5])}.")
    out: list[dict[str, Any]] = []
    for row in rows:  # continúa después del encabezado
        if row is None or all(v is None for v in row):
            continue
        rec = {c.lower(): _norm(row[i]) if i < len(row) else None for c, i in idx.items()}
        if rec.get("sds_number") is None:
            continue
        rec["sds_number"] = str(rec["sds_number"]).strip()
        out.append(rec)
    return out


def parse_ventas_netas(path: str) -> dict[str, Any]:
    """Lee el .xlsx y devuelve {'ddi': [...], 'cargas': [...], 'portabilidad': [...], 'hojas': [...]}."""
    try:
        wb = load_workbook(path, read_only=True, data_only=True)
    except Exception as exc:  # archivo corrupto o no es xlsx
        raise ArchivoInvalido("No se pudo abrir el archivo. Debe ser un .xlsx de Excel válido.") from exc
    try:
        por_nombre = {ws.title.strip().upper(): ws for ws in wb.worksheets}
        result: dict[str, Any] = {"hojas": [ws.title for ws in wb.worksheets]}
        for key, (nombre, primera, obligatoria) in HOJAS.items():
            ws = por_nombre.get(nombre)
            if ws is None:
                if obligatoria:
                    raise ArchivoInvalido(
                        f"Falta la hoja '{nombre}'. El archivo debe tener las hojas DDI, CARGAS y PORTABILIDAD."
                    )
                result[key] = []
                continue
            result[key] = _parse_sheet(ws, primera, COLUMNAS[key])
        if not result["ddi"] and not result["cargas"]:
            raise ArchivoInvalido("El archivo no contiene filas de datos.")
        return result
    finally:
        wb.close()
