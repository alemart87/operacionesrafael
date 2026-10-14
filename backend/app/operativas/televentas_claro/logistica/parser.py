"""Parser del .xlsx de pedidos de logística (una hoja, una fila por pedido).

Columnas del modelo: Nro. Formulario, LINEA_ORIG, Nro. Documento Cliente, Nombre Completa, Ciudad Cliente,
Departamento, REGION, Fecha Venta, Ven_Nombre Completo, Promoción, ESTADO, MOTIVO. Los nombres se reconocen sin
tildes, mayúsculas ni puntuación, con alias; la fila de encabezados se busca entre las primeras 20 (tolera títulos
arriba). Devuelve filas normalizadas: textos en mayúsculas, fechas ISO, estado canónico (ENTREGADO · EN GESTION ·
DEVUELTO) y motivo (si falta, el estado).
"""
from __future__ import annotations

import io
import re
import unicodedata
from datetime import date, datetime
from typing import Any

from openpyxl import load_workbook

MAX_FILAS = 50_000
ENTREGADO, EN_GESTION, DEVUELTO = "ENTREGADO", "EN GESTION", "DEVUELTO"
ESTADOS = (ENTREGADO, EN_GESTION, DEVUELTO)

# clave interna → nombres aceptados (normalizados: sin tildes, mayúsculas, sin puntuación)
ALIAS: dict[str, tuple[str, ...]] = {
    "formulario": ("NRO FORMULARIO", "NRO DE FORMULARIO", "FORMULARIO", "SDS FORMULARIO", "NUMERO FORMULARIO"),
    "linea": ("LINEA ORIG", "LINEA", "NRO LINEA", "LINEA ORIGEN"),
    "documento": ("NRO DOCUMENTO CLIENTE", "NRO DOCUMENTO", "DOCUMENTO", "CEDULA", "CI", "DOCUMENTO CLIENTE"),
    "cliente": ("NOMBRE COMPLETA", "NOMBRE COMPLETO", "CLIENTE", "NOMBRE CLIENTE", "NOMBRE"),
    "ciudad": ("CIUDAD CLIENTE", "CIUDAD"),
    "departamento": ("DEPARTAMENTO", "DEPTO", "DPTO"),
    "region": ("REGION", "ZONA"),
    "fecha": ("FECHA VENTA", "FECHA DE VENTA", "FECHA", "FECHA PEDIDO"),
    "fecha_entrega": ("FECHA DE ENTREGA", "FECHA ENTREGA", "FECHA ENTREGADO", "FECHA DE ENTREGADO", "ENTREGADO EL", "FECHA DE ENTREGA REAL"),
    "vendedor": ("VEN NOMBRE COMPLETO", "VENDEDOR", "VENDEDOR NOMBRE", "ASESOR", "VEN NOMBRE"),
    "promocion": ("PROMOCION", "PROMO", "CAMPANIA", "CAMPANA"),
    "estado": ("ESTADO", "ESTADO ENTREGA", "ESTADO PEDIDO"),
    "motivo": ("MOTIVO", "MOTIVO ESTADO", "OBSERVACION", "SUBESTADO"),
}
OBLIGATORIAS = ("formulario", "fecha", "estado")
ETIQUETA = {"formulario": "Nro. Formulario", "fecha": "Fecha Venta", "estado": "ESTADO", "region": "REGION"}


class ArchivoInvalido(ValueError):
    pass


def normalizar(v: Any) -> str:
    """Mayúsculas, sin tildes ni puntuación, espacios simples (para comparar encabezados y categorías)."""
    s = "" if v is None else str(v)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^A-Za-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip().upper()


def _texto(v: Any) -> str | None:
    if v is None:
        return None
    s = re.sub(r"\s+", " ", str(v)).strip()
    return s.upper() if s else None


def _fecha(v: Any) -> str | None:
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, (int, float)) and 20000 < float(v) < 80000:   # serial de Excel
        from datetime import timedelta
        return (date(1899, 12, 30) + timedelta(days=int(v))).isoformat()
    if isinstance(v, str):
        s = v.strip()
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%y"):
            try:
                return datetime.strptime(s, fmt).date().isoformat()
            except ValueError:
                continue
    return None


def estado_canonico(v: Any) -> str | None:
    s = normalizar(v)
    if not s:
        return None
    if s.startswith("ENTREG"):
        return ENTREGADO
    if s.startswith("EN GESTION") or s == "GESTION" or s.startswith("PENDIENTE"):
        return EN_GESTION
    if s.startswith("DEVUEL") or s.startswith("DEVOLU") or s.startswith("RECHAZ"):
        return DEVUELTO
    return s


def _encabezado(filas: list[tuple]) -> tuple[int, dict[str, int]]:
    """La fila con ESTADO y Fecha Venta (o Formulario): índice y columna de cada clave."""
    for i, fila in enumerate(filas[:20]):
        nombres = [normalizar(c) for c in fila]
        idx: dict[str, int] = {}
        for clave, alias in ALIAS.items():
            for j, nombre in enumerate(nombres):
                if nombre and nombre in alias and clave not in idx:
                    idx[clave] = j
        if "estado" in idx and ("fecha" in idx or "formulario" in idx):
            return i, idx
    raise ArchivoInvalido("No es el archivo de pedidos de logística: no encuentro la fila de encabezados con "
                          "«ESTADO» y «Fecha Venta» (o «Nro. Formulario»).")


def parse_logistica(contenido: bytes) -> dict[str, Any]:
    """{'filas': [...], 'columnas': [claves encontradas], 'hoja': nombre}."""
    try:
        wb = load_workbook(io.BytesIO(contenido), read_only=True, data_only=True)
    except Exception as exc:  # noqa: BLE001
        raise ArchivoInvalido("No se pudo abrir el archivo. Debe ser un .xlsx de Excel válido.") from exc
    # La hoja de pedidos es la primera que tiene la fila de encabezados: el archivo puede traer antes una hoja
    # «resumen» con tablas dinámicas (como el corte de octubre 2026).
    try:
        hojas = [(ws.title, [tuple(r) for r in ws.iter_rows(values_only=True)]) for ws in wb.worksheets]
    finally:
        wb.close()
    titulo, filas, i, idx = None, [], 0, {}
    for titulo, filas in hojas:
        try:
            i, idx = _encabezado(filas)
            break
        except ArchivoInvalido:
            continue
    else:
        if not any(filas for _, filas in hojas):
            raise ArchivoInvalido("El archivo está vacío.")
        raise ArchivoInvalido("No es el archivo de pedidos de logística: ninguna hoja tiene la fila de encabezados con "
                              "«ESTADO» y «Fecha Venta» (o «Nro. Formulario»).")
    faltan = [ETIQUETA[c] for c in OBLIGATORIAS if c not in idx]
    if faltan:
        raise ArchivoInvalido("Faltan columnas obligatorias: " + ", ".join(faltan) + ".")
    out: list[dict[str, Any]] = []
    sin_fecha = 0
    for n, fila in enumerate(filas[i + 1:], start=i + 2):
        if not any(c is not None and str(c).strip() for c in fila):
            continue
        celda = lambda k: fila[idx[k]] if k in idx and idx[k] < len(fila) else None  # noqa: E731
        formulario = _texto(celda("formulario"))
        estado = estado_canonico(celda("estado"))
        if not formulario and not estado:
            continue
        fecha = _fecha(celda("fecha"))
        if fecha is None:
            sin_fecha += 1
            continue
        documento = celda("documento")
        motivo = _texto(celda("motivo"))
        out.append({
            "fila": n, "formulario": formulario, "linea": _texto(celda("linea")),
            "documento": str(documento).strip() if documento is not None else None,
            "cliente": _texto(celda("cliente")), "ciudad": _texto(celda("ciudad")), "departamento": _texto(celda("departamento")),
            "region": _texto(celda("region")) or "SIN REGION", "fecha": fecha, "vendedor": _texto(celda("vendedor")),
            "promocion": _texto(celda("promocion")), "estado": estado or "SIN ESTADO", "motivo": motivo or estado or "SIN MOTIVO",
            "motivo_informado": bool(motivo), "fecha_entrega": _fecha(celda("fecha_entrega")),
        })
        if len(out) > MAX_FILAS:
            raise ArchivoInvalido(f"El archivo tiene más de {MAX_FILAS} pedidos.")
    if not out:
        raise ArchivoInvalido("El archivo no tiene filas de pedidos con fecha de venta.")
    return {"filas": out, "columnas": sorted(idx), "hoja": titulo, "sin_fecha": sin_fecha}
