"""Proyección a fin de mes de los pedidos (ventas) del corte.

Método («ritmo actual», estadística descriptiva, sin modelos ajustados a mano):
1. Serie diaria de pedidos del mes del informe por fecha de venta. Los días laborables se infieren del propio archivo:
   los días de la semana en los que hubo ventas (en Voicenter, de lunes a sábado; el domingo no aparece).
2. **Ritmo**: promedio de los días cuyo volumen está **en la media o por encima** (los días por debajo, p. ej. el
   arranque lento del mes, no cuentan: es lo que pidió la gerencia para medir «el ritmo actual»). Si quedan menos de
   dos días así, se usan todos.
3. **Proyección** = acumulado + ritmo × días laborables restantes (después del último día con ventas, hasta fin de mes).
4. **Intervalo del 95 %**: los días se tratan como observaciones independientes con el desvío de los días del ritmo:
   proyección ± 1,96 · s · √(días restantes).
5. **Rango de referencia**: «conservador» con la media de todos los días; «tendencia» con una recta de mínimos
   cuadrados sobre la serie diaria (si la pendiente es positiva), evaluada en los días que faltan.
Por región se proyecta con el mismo método sobre la serie de cada una. Las entregas esperadas aplican el % de
entregados del corte a la proyección. Hace falta al menos 3 días con ventas; si no, se explica por qué no hay proyección.
"""
from __future__ import annotations

import calendar
import math
from collections import Counter, defaultdict
from datetime import date, timedelta
from typing import Any

MIN_DIAS = 3
Z95 = 1.96
LABORABLES_DEFECTO = (0, 1, 2, 3, 4, 5)   # lunes a sábado


def _media(xs: list[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0


def _desvio(xs: list[float]) -> float:
    if len(xs) < 2:
        return 0.0
    m = _media(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def _pendiente(ys: list[float]) -> float:
    """Pendiente de la recta de mínimos cuadrados sobre x = 0..n-1."""
    n = len(ys)
    if n < 2:
        return 0.0
    xm, ym = (n - 1) / 2, _media(ys)
    sxx = sum((i - xm) ** 2 for i in range(n))
    return sum((i - xm) * (y - ym) for i, y in enumerate(ys)) / sxx if sxx else 0.0


def _laborables(fechas: list[date]) -> tuple[int, ...]:
    vistos = sorted({f.weekday() for f in fechas})
    return tuple(vistos) if len(vistos) >= 3 else LABORABLES_DEFECTO


def _restantes(ultimo: date, laborables: tuple[int, ...]) -> list[date]:
    fin = date(ultimo.year, ultimo.month, calendar.monthrange(ultimo.year, ultimo.month)[1])
    d, out = ultimo + timedelta(days=1), []
    while d <= fin:
        if d.weekday() in laborables:
            out.append(d)
        d += timedelta(days=1)
    return out


def _proyectar_serie(por_dia: dict[date, int], laborables: tuple[int, ...], ultimo: date) -> dict[str, Any]:
    fechas = sorted(por_dia)
    ys = [float(por_dia[f]) for f in fechas]
    acumulado = int(sum(ys))
    restantes = _restantes(ultimo, laborables)
    k = len(restantes)
    media = _media(ys)
    en_ritmo = [f for f in fechas if por_dia[f] >= media]
    if len(en_ritmo) < 2:
        en_ritmo = fechas
    ritmo_vals = [float(por_dia[f]) for f in en_ritmo]
    ritmo, s = _media(ritmo_vals), _desvio(ritmo_vals)
    pend = _pendiente(ys)
    tend = sum(max(0.0, ys[-1] + pend * (i + 1)) for i in range(k)) if pend > 0 else media * k
    proy = acumulado + ritmo * k
    margen = Z95 * s * math.sqrt(k) if k else 0.0
    return {
        "acumulado": acumulado, "dias_con_ventas": len(fechas), "media_diaria": round(media, 1), "ritmo": round(ritmo, 1),
        "desvio": round(s, 1), "dias_en_ritmo": [f.isoformat() for f in en_ritmo], "dias_restantes": k,
        "proyeccion": int(round(proy)),
        "intervalo_95": {"bajo": int(round(max(acumulado, proy - margen))), "alto": int(round(proy + margen))},
        "rango": {"conservador": int(round(acumulado + media * k)), "tendencia": int(round(acumulado + tend))},
        "pendiente_diaria": round(pend, 2), "_ritmo": ritmo, "_desvio": s,
    }


def proyectar(pedidos: list[dict[str, Any]], periodo: str, pct_entregados: float | None) -> dict[str, Any]:
    """`pedidos`: filas con `fecha` (ISO) y `region`. Solo cuentan las del mes `periodo`."""
    del_mes = [p for p in pedidos if (p.get("fecha") or "")[:7] == periodo]
    por_dia: dict[date, int] = Counter(date.fromisoformat(p["fecha"]) for p in del_mes)
    fechas = sorted(por_dia)
    y, m = (int(x) for x in periodo.split("-"))
    fin_mes = date(y, m, calendar.monthrange(y, m)[1])
    base = {"disponible": False, "mes": periodo, "fin_mes": fin_mes.isoformat(), "dias_con_ventas": len(fechas),
            "acumulado": len(del_mes)}
    if len(fechas) < MIN_DIAS:
        return {**base, "motivo": f"Hacen falta al menos {MIN_DIAS} días con ventas en el mes; el archivo trae {len(fechas)}."}
    laborables = _laborables(fechas)
    ultimo = fechas[-1]
    if not _restantes(ultimo, laborables):
        return {**base, "motivo": "El mes ya está completo: no quedan días laborables por proyectar.",
                "dias_laborables": list(laborables), "ultimo_dia": ultimo.isoformat()}
    total = _proyectar_serie(por_dia, laborables, ultimo)
    por_region: dict[str, dict[str, Any]] = {}
    series_region: dict[str, dict[date, int]] = defaultdict(lambda: defaultdict(int))
    for p in del_mes:
        series_region[p.get("region") or "SIN REGION"][date.fromisoformat(p["fecha"])] += 1
    for r, serie in series_region.items():
        if len(serie) >= MIN_DIAS:
            por_region[r] = _proyectar_serie(dict(serie), laborables, ultimo)
    # La serie para el gráfico: acumulado real y, después del último día, la proyección día a día con su banda.
    serie, acum = [], 0
    for f in fechas:
        acum += por_dia[f]
        serie.append({"fecha": f.isoformat(), "real": por_dia[f], "acumulado": acum})
    serie[-1].update({"proyectado": acum, "bajo": acum, "alto": acum})   # la proyección arranca donde termina lo real
    restantes = _restantes(ultimo, laborables)
    s, ritmo = total.pop("_desvio"), total.pop("_ritmo")
    for r in por_region.values():
        r.pop("_ritmo", None), r.pop("_desvio", None)
    for i, f in enumerate(restantes, start=1):
        est = acum + ritmo * i
        margen = Z95 * s * math.sqrt(i)
        serie.append({"fecha": f.isoformat(), "proyectado": int(round(est)), "bajo": int(round(max(acum, est - margen))),
                      "alto": int(round(est + margen))})
    pct = (pct_entregados or 0) / 100
    return {
        **base, "disponible": True, "motivo": None, "ultimo_dia": ultimo.isoformat(), "dias_laborables": list(laborables),
        "dias_transcurridos": len(fechas), "fecha_fin_proyeccion": restantes[-1].isoformat(),
        **{k: v for k, v in total.items() if k != "acumulado"},
        "entregas_esperadas": int(round(total["proyeccion"] * pct)) if pct_entregados is not None else None,
        "por_region": por_region, "serie": serie,
        "metodo": ("Ritmo = promedio de los días con ventas en la media o por encima; proyección = acumulado + ritmo × días "
                   "laborables restantes (los días laborables salen del archivo); intervalo del 95 % con el desvío de esos días; "
                   "rango con la media de todos los días (conservador) y la tendencia lineal."),
    }
