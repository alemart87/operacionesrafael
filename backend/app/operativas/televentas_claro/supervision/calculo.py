"""Supervisión: cuentas puras (sin base de datos).

- Días hábiles: cada día del mes pesa según su día de la semana (por defecto de lunes a viernes 1,
  el sábado 0,5 y el domingo 0) y los feriados o días no laborables no cuentan.
- Proyección al cierre = vendido al corte ÷ días hábiles transcurridos × días hábiles del mes.
  Ritmo necesario = (objetivo − vendido) ÷ días hábiles restantes.
- Netas del mes: las del informe de Ventas Netas del mes (mes de activación: la cifra oficial, la
  que cuadra con Claro). Cada neta cuenta para el supervisor que tenía al asesor el día de la
  venta; si la venta es de antes del mes (se activó este mes), para el que lo tenía el día 1.
- Asesor en alerta: más del `umbral_sin_uso` % de sus Pospago evaluables sin uso, con al menos
  `min_evaluables` evaluables (no cuentan las «en espera»: activadas hace menos de 3 días).
  Supervisor crítico: al menos un asesor de su equipo en alerta.
- Líneas a recuperar: sin uso que tienen que empezar a usarse para quedar en el umbral o menos.
"""
from __future__ import annotations

import math
import re
from collections import defaultdict
from datetime import date, timedelta
from typing import Any, Iterable

SIN_VENDEDOR = "SIN VENDEDOR"

PARAMETROS_DEFECTO: dict[str, Any] = {
    "pesos_dia": [1, 1, 1, 1, 1, 0.5, 0],  # lunes … domingo
    "no_laborables": [],                     # [{"fecha": "YYYY-MM-DD", "motivo": "…"}], además de los feriados
    "umbral_sin_uso": 10.0,                  # % de Pospago evaluables sin uso: más que esto, asesor en alerta
    "min_evaluables": 5,
    "semaforo_en_camino": 100.0,             # proyección ÷ objetivo, en %
    "semaforo_en_riesgo": 90.0,
    "min_dias_proyeccion": 3.0,              # con menos días hábiles transcurridos, la proyección es provisoria
}

_PERIODO = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")


# ------------------------------------------------------------------ meses
def validar_periodo(periodo: str) -> str:
    if not isinstance(periodo, str) or not _PERIODO.match(periodo) or not 2020 <= int(periodo[:4]) <= 2100:
        raise ValueError("Período inválido: usá el formato AAAA-MM")
    return periodo


def limites(periodo: str) -> tuple[date, date]:
    """Primer y último día del mes."""
    y, m = int(periodo[:4]), int(periodo[5:7])
    primero = date(y, m, 1)
    ultimo = (primero.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    return primero, ultimo


def mes_de(d: date) -> str:
    return d.strftime("%Y-%m")


def mes_anterior(periodo: str) -> str:
    return mes_de(limites(periodo)[0] - timedelta(days=1))


def mes_siguiente(periodo: str) -> str:
    return mes_de(limites(periodo)[1] + timedelta(days=1))


def _fecha(x: Any) -> date | None:
    try:
        return date.fromisoformat(str(x)[:10]) if x else None
    except ValueError:
        return None


# ------------------------------------------------------------------ días hábiles y proyección
def calendario(periodo: str, corte: date | None, pesos: list[float], feriados: Iterable[str]) -> dict[str, Any]:
    """Días hábiles del mes, transcurridos hasta el corte (inclusive) y restantes."""
    primero, ultimo = limites(periodo)
    no_cuentan = set(feriados)
    total = transcurridos = 0.0
    d = primero
    while d <= ultimo:
        peso = 0.0 if d.isoformat() in no_cuentan else float(pesos[d.weekday()])
        total += peso
        if corte and d <= corte:
            transcurridos += peso
        d += timedelta(days=1)
    return {
        "total": round(total, 2), "transcurridos": round(transcurridos, 2),
        "restantes": round(total - transcurridos, 2),
        "corte": corte.isoformat() if corte else None,
        "cerrado": bool(corte and corte >= ultimo),
    }


def proyeccion(vendido: int | None, objetivo: int | None, cal: dict[str, Any], p: dict[str, Any]) -> dict[str, Any]:
    """Avance contra el objetivo y cierre proyectado al mismo ritmo por día hábil."""
    hay_datos = vendido is not None and cal["corte"] is not None
    vendido = vendido or 0
    if not hay_datos:
        proy = None
    elif cal["cerrado"]:
        proy = float(vendido)
    elif cal["transcurridos"] > 0:
        proy = vendido / cal["transcurridos"] * cal["total"]
    else:
        proy = None
    obj = objetivo if objetivo and objetivo > 0 else None
    pct_logro = round(vendido / obj * 100, 1) if obj and hay_datos else None
    pct_proy = round(proy / obj * 100, 1) if obj and proy is not None else None
    faltan = max(obj - vendido, 0) if obj and hay_datos else None
    if faltan is None:
        ritmo = None
    elif faltan == 0:
        ritmo = 0.0
    else:
        ritmo = round(faltan / cal["restantes"], 1) if cal["restantes"] > 0 else None
    esperado = round(obj * cal["transcurridos"] / cal["total"], 1) if obj and cal["total"] > 0 and hay_datos else None
    if not obj:
        estado = "sin_objetivo"
    elif pct_proy is None:
        estado = "sin_datos"
    elif pct_proy >= p["semaforo_en_camino"]:
        estado = "en_camino"
    elif pct_proy >= p["semaforo_en_riesgo"]:
        estado = "en_riesgo"
    else:
        estado = "bajo_objetivo"
    return {
        "vendido": vendido if hay_datos else None, "objetivo": obj, "esperado_al_corte": esperado,
        "proyeccion": round(proy, 1) if proy is not None else None,
        "pct_logro": pct_logro, "pct_proyeccion": pct_proy, "faltan": faltan, "ritmo_necesario": ritmo,
        "estado": estado,
        "provisoria": bool(hay_datos and not cal["cerrado"] and cal["transcurridos"] < p["min_dias_proyeccion"]),
    }


# ------------------------------------------------------------------ netas del mes
def lineas_netas(data: dict[str, Any], periodo: str, corte: date | None) -> list[dict[str, Any]]:
    """Netas del informe de Ventas Netas del mes con lo que usa Supervisión.

    `fecha` es el día que decide el supervisor: el de la venta (si no viene, la carga o la
    activación), llevado al día 1 si es de antes del mes y al corte si es posterior."""
    primero, _ = limites(periodo)
    out: list[dict[str, Any]] = []
    for x in data.get("detalle_netas") or []:
        prod = x.get("producto")
        f = _fecha(x.get("fecha_venta")) or _fecha(x.get("fecha_carga")) or _fecha(x.get("fecha_activacion")) or primero
        f = max(f, primero)
        if corte and f > corte:
            f = corte
        pospago = prod == "Pospago"
        espera = pospago and bool(x.get("en_espera"))
        out.append({
            "vendedor": x.get("vendedor") or SIN_VENDEDOR,
            "producto": prod,
            "fecha": f,
            "evaluable": pospago and not espera,
            "sin_uso": pospago and not espera and x.get("consumo") != "SI",
            "en_espera": espera,
            "sds": x.get("sds_number"), "linea": x.get("linea"), "plan": x.get("plan"),
            "fecha_activacion": x.get("fecha_activacion"), "dias": x.get("dias"),
        })
    return out


def supervisor_en(tramos: list[tuple[date, str | None]], d: date) -> str | None:
    """Supervisor de un asesor un día: el del tramo con el mayor `desde` ≤ d (tramos ordenados)."""
    sup = None
    for desde, s in tramos:
        if desde > d:
            break
        sup = s
    return sup


def uso(evaluables: int, sin_uso: int, en_espera: int, p: dict[str, Any]) -> dict[str, Any]:
    """Uso de líneas de un asesor: % sin uso, alerta y líneas a recuperar."""
    pct = round(sin_uso / evaluables * 100, 1) if evaluables else None
    alerta = evaluables >= p["min_evaluables"] and pct is not None and pct > p["umbral_sin_uso"]
    permitidas = math.floor(p["umbral_sin_uso"] * evaluables / 100 + 1e-9)
    return {"evaluables": evaluables, "sin_uso": sin_uso, "en_espera": en_espera, "pct_sin_uso": pct,
            "alerta": alerta, "a_recuperar": max(sin_uso - permitidas, 0) if alerta else 0}


def atribuir(lineas: list[dict[str, Any]], operador_de: dict[str, str],
             tramos: dict[str, list[tuple[date, str | None]]], p: dict[str, Any]) -> dict[str, Any]:
    """Reparte las netas del mes por supervisor (según el día de la venta) y calcula el uso de cada asesor.

    `operador_de`: vendedor → id del operador. `tramos`: id del operador → [(desde, supervisor)] del mes."""
    por_sup: dict[str | None, dict[str, Any]] = defaultdict(lambda: {"pospago": 0, "gpon": 0, "asesores": defaultdict(lambda: {"pospago": 0, "gpon": 0})})
    cuenta: dict[str, dict[str, int]] = defaultdict(lambda: {"pospago": 0, "gpon": 0, "evaluables": 0, "sin_uso": 0, "en_espera": 0})
    sin_operador: dict[str, dict[str, int]] = defaultdict(lambda: {"pospago": 0, "gpon": 0})
    total = {"netas": 0, "pospago": 0, "gpon": 0}
    for ln in lineas:
        clave = "pospago" if ln["producto"] == "Pospago" else "gpon" if ln["producto"] == "GPON" else None
        total["netas"] += 1
        if clave:
            total[clave] += 1
        op = operador_de.get(ln["vendedor"])
        if not op:
            if clave:
                sin_operador[ln["vendedor"]][clave] += 1
            continue
        c = cuenta[op]
        if clave:
            c[clave] += 1
        c["evaluables"] += ln["evaluable"]
        c["sin_uso"] += ln["sin_uso"]
        c["en_espera"] += ln["en_espera"]
        if clave:
            sup = supervisor_en(tramos.get(op, []), ln["fecha"])
            b = por_sup[sup]
            b[clave] += 1
            b["asesores"][op][clave] += 1
    operadores = {op: {"pospago": c["pospago"], "gpon": c["gpon"], **uso(c["evaluables"], c["sin_uso"], c["en_espera"], p)}
                  for op, c in cuenta.items()}
    return {
        "supervisores": {s: {"pospago": b["pospago"], "gpon": b["gpon"], "asesores": {k: dict(v) for k, v in b["asesores"].items()}}
                         for s, b in por_sup.items()},
        "operadores": operadores,
        "sin_operador": {v: dict(x) for v, x in sin_operador.items()},
        "total": total,
    }
