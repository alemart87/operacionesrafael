"""Lectura del CSV "Tiempos Acumulados" de la plataforma de discado.

Una fila por agente con sus totales acumulados del día hasta la hora del export.
La fecha y hora del corte vienen en el nombre del archivo como marca de tiempo
Unix (p. ej. `Tiempos_Acumulados_1791406800981.csv` = 07/10/2026 18:00 en Asunción).
"""
from __future__ import annotations

import csv
import io
import re
import unicodedata
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

ZONA = ZoneInfo("America/Asuncion")
MAX_FILAS = 5000

# Encabezado normalizado (minúsculas, solo letras y números) → campo.
COLUMNAS = {
    "name": "nombre",
    "logintime": "login",
    "readytime": "ready",
    "notreadytime": "not_ready",
    "handletime": "handle",
    "outtime": "conversacion",
    "holdtime": "hold",
    "acwtime": "acw",
    "out": "llamadas",
}
# "Short Talk < 10s": llamadas con menos de N segundos de conversación. El umbral viene en el
# nombre de la columna; si la plataforma lo configura en 20 s, el contacto se mide exacto.
_CORTAS = re.compile(r"^shorttalk(\d+)s$")
OPCIONALES = {"aht": "aht", "avgouttime": "prom_conversacion", "agentoccupancy": "ocupacion"}
TIEMPOS = ("login", "ready", "not_ready", "handle", "conversacion", "hold", "acw", "aht", "prom_conversacion")
ETIQUETA = {
    "nombre": "Name", "login": "Login Time", "ready": "Ready Time", "not_ready": "Not Ready Time",
    "handle": "Handle Time", "conversacion": "Out Time", "hold": "Hold Time", "acw": "ACW Time",
    "llamadas": "Out", "cortas": "Short Talk < N s",
}

_HMS = re.compile(r"^(\d{1,4}):([0-5]\d):([0-5]\d)$")
_MARCA = re.compile(r"(?<!\d)(\d{13}|\d{10})(?!\d)")
_PRUEBA = re.compile(r"(^|[\s,])test(_|\b)", re.IGNORECASE)
_PARTICULAS = {"de", "del", "la", "las", "los", "y", "da", "dos", "van", "von"}


class ArchivoInvalido(ValueError):
    """El archivo no es el reporte de tiempos esperado (mensaje apto para el usuario)."""


def _norm_encabezado(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").strip().lower())


def _segundos(valor: str, fila: int, campo: str) -> int:
    v = (valor or "").strip()
    if not v:
        return 0
    m = _HMS.match(v)
    if not m:
        raise ArchivoInvalido(f"Fila {fila}: «{ETIQUETA.get(campo, campo)}» no es un tiempo HH:MM:SS ({v!r}).")
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3))


def _entero(valor: str, fila: int, campo: str) -> int:
    v = (valor or "").strip()
    if not v:
        return 0
    if not v.isdigit():
        raise ArchivoInvalido(f"Fila {fila}: «{ETIQUETA.get(campo, campo)}» no es un número ({v!r}).")
    return int(v)


def _porcentaje(valor: str) -> float | None:
    v = (valor or "").strip().rstrip("%").replace(",", ".")
    try:
        return float(v) if v else None
    except ValueError:
        return None


def _texto(contenido: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return contenido.decode(enc)
        except UnicodeDecodeError:
            continue
    raise ArchivoInvalido("No se pudo leer el archivo: la codificación no es UTF-8 ni Windows-1252.")


def parse_tiempos(contenido: bytes) -> dict[str, Any]:
    """Reporte leído: {"filas": una por agente (tiempos en segundos, llamadas enteras y llamadas cortas
    por umbral), "umbrales": los segundos de cada columna Short Talk (p. ej. [10] o [10, 20, 30])}."""
    texto = _texto(contenido)
    muestra = texto[:4096]
    try:
        delim = csv.Sniffer().sniff(muestra, delimiters=",;\t").delimiter
    except csv.Error:
        delim = ","
    lector = csv.reader(io.StringIO(texto), delimiter=delim)

    encabezado: list[str] | None = None
    for fila in lector:
        if any(c.strip() for c in fila):
            encabezado = fila
            break
    if not encabezado:
        raise ArchivoInvalido("El archivo está vacío.")
    indices: dict[str, int] = {}
    # Puede haber varias columnas de cortas (p. ej. «< 10s», «< 20s», «< 30s»): umbral → columna.
    cortas_cols: dict[int | None, int] = {}
    for i, col in enumerate(encabezado):
        norm = _norm_encabezado(col)
        campo = COLUMNAS.get(norm) or OPCIONALES.get(norm)
        if not campo and (m := _CORTAS.match(norm)):
            cortas_cols.setdefault(int(m.group(1)), i)
            continue
        if not campo and norm == "shorttalk":
            cortas_cols.setdefault(None, i)  # sin umbral en el nombre: no se sabe desde cuántos segundos cuenta
            continue
        if campo and campo not in indices:
            indices[campo] = i
    faltan = [ETIQUETA[c] for c in COLUMNAS.values() if c not in indices] + ([] if cortas_cols else [ETIQUETA["cortas"]])
    if faltan:
        raise ArchivoInvalido(
            "No es el reporte de Tiempos Acumulados de la plataforma: faltan las columnas " + ", ".join(faltan) + "."
        )

    filas: list[dict[str, Any]] = []
    for n, fila in enumerate(lector, start=2):
        if not any(c.strip() for c in fila):
            continue
        celda = lambda campo: fila[indices[campo]] if campo in indices and indices[campo] < len(fila) else ""  # noqa: E731
        nombre = " ".join(celda("nombre").split())
        if not nombre:
            continue
        r: dict[str, Any] = {"nombre": nombre}
        for campo in TIEMPOS:
            if campo in indices:
                r[campo] = _segundos(celda(campo), n, campo)
        r["llamadas"] = _entero(celda("llamadas"), n, "llamadas")
        r["cortas_por_umbral"] = {}
        for umbral, idx in cortas_cols.items():
            v = _entero(fila[idx] if idx < len(fila) else "", n, "cortas")
            if v > r["llamadas"]:
                raise ArchivoInvalido(f"Fila {n}: hay más llamadas cortas que llamadas ({nombre}).")
            r["cortas_por_umbral"][umbral] = v
        if "ocupacion" in indices:
            r["ocupacion"] = _porcentaje(celda("ocupacion"))
        filas.append(r)
        if len(filas) > MAX_FILAS:
            raise ArchivoInvalido(f"El archivo tiene más de {MAX_FILAS} filas: no parece el reporte diario por agente.")
    if not filas:
        raise ArchivoInvalido("El archivo no tiene filas de agentes.")
    return {"filas": filas, "umbrales": sorted(cortas_cols, key=lambda u: (u is None, u or 0))}


def corte_de_nombre(nombre_archivo: str | None) -> datetime | None:
    """Fecha y hora del corte (UTC) a partir de la marca de tiempo del nombre del archivo, si la tiene."""
    for marca in reversed(_MARCA.findall(nombre_archivo or "")):
        valor = int(marca)
        try:
            dt = datetime.fromtimestamp(valor / 1000 if len(marca) == 13 else valor, timezone.utc)
        except (OverflowError, OSError, ValueError):
            continue
        if 2020 <= dt.year <= 2100:
            return dt
    return None


def a_local(dt: datetime) -> datetime:
    """Hora local de Asunción, al minuto (la etiqueta de cada corte)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(ZONA).replace(second=0, microsecond=0)


def clave_agente(nombre: str) -> str:
    """Identidad del agente entre cortes y días: sin tildes, en mayúsculas y con espacios normalizados."""
    s = unicodedata.normalize("NFKD", nombre or "").encode("ascii", "ignore").decode().upper()
    s = re.sub(r"\s*,\s*", ", ", " ".join(s.split())).strip(" ,")
    return s


def nombre_visible(nombre: str) -> str:
    """'QUIÑONEZ, JESSICA BELEN' → 'Quiñonez, Jessica Belen' (sin coma final si no trae nombre)."""
    def palabra(p: str, primera: bool) -> str:
        low = p.lower()
        return low if (low in _PARTICULAS and not primera) else low[:1].upper() + low[1:]

    partes = [" ".join(palabra(p, i == 0) for i, p in enumerate(t.split())) for t in (nombre or "").split(",")]
    return ", ".join(p for p in partes if p)


def es_prueba(nombre: str) -> bool:
    """Cuentas de prueba de la plataforma (p. ej. 'test_vc, test_vc'): no cuentan como agentes."""
    return bool(_PRUEBA.search(nombre or ""))
