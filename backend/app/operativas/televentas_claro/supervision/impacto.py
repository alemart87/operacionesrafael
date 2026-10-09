"""Impacto de un coaching medido con datos: antes contra después (cuentas puras).

- Conversación: % de conversación de los 5 días con conexión anteriores al coaching contra los
  5 posteriores (Productividad, sin sesiones abiertas).
- Pospago / GPON: netas por hora conectada en esas mismas ventanas, con las netas por día de venta.
  Las netas de un día se siguen activando hasta una semana después: del «después» solo cuentan los
  días con las activaciones ya maduras (7 días antes de hasta dónde llegan los informes de Ventas Netas).
- Uso de líneas: % sin uso de las Pospago vendidas después del coaching contra las de antes, con la
  misma antigüedad. Las de antes salen de la foto que se guarda al registrar el coaching (cuántas había
  de cada antigüedad y cuántas sin uso); las de después, del informe actual. Se comparan las mismas
  antigüedades (de 3 días de activadas, cuando dejan de estar «en espera», hasta 21): así ninguna de
  las dos tuvo más días para empezar a usarse.
- Resultado: mejoró / igual / empeoró según una banda de tolerancia, o «sin datos» si alguno de los dos
  lados no tiene datos suficientes. «Completo» cuando el después ya tiene todos sus días.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any, Iterable

VENTANA = 5           # días con conexión de cada lado
DIAS_ATRAS = 21       # hasta dónde se buscan los días anteriores (y los posteriores)
MIN_HORAS = 4.0       # conexión mínima de cada lado
MIN_LINEAS = 3        # uso: líneas evaluables mínimas de cada lado
EDAD_MIN = 3          # días desde la activación: antes, la línea está «en espera» y no se evalúa
EDAD_MAX = 21         # se comparan líneas de hasta 3 semanas de activadas
DIAS_MADURACION = 7   # las netas de un día se siguen activando hasta una semana después
BANDA_PP = 2.0        # conversación: ± puntos porcentuales = igual
BANDA_REL = 10.0      # netas por hora: ± % = igual
BANDA_USO_PP = 5.0    # uso: ± puntos porcentuales = igual

METRICAS = ("pospago", "gpon", "uso", "conversacion", "otra")


def _por_dia(prod: Iterable[tuple[date, int, int]]) -> dict[date, list[int]]:
    out: dict[date, list[int]] = defaultdict(lambda: [0, 0])
    for d, login, conv in prod:
        out[d][0] += login
        out[d][1] += conv
    return out


def ventanas(dias: Iterable[date], fecha: date, hasta: date) -> tuple[list[date], list[date]]:
    """Los últimos 5 días con datos antes del coaching y los primeros 5 después (hasta `hasta`)."""
    ds = sorted(set(dias))
    antes = [d for d in ds if fecha - timedelta(days=DIAS_ATRAS) <= d < fecha][-VENTANA:]
    despues = [d for d in ds if fecha < d <= min(hasta, fecha + timedelta(days=DIAS_ATRAS))][:VENTANA]
    return antes, despues


def _lado(dias: list[date], **valores: Any) -> dict[str, Any]:
    return {"desde": dias[0].isoformat() if dias else None, "hasta": dias[-1].isoformat() if dias else None,
            "dias": len(dias), **valores}


def _resultado(delta: float | None, banda: float, mejor_si_sube: bool = True) -> str:
    if delta is None:
        return "sin_datos"
    d = delta if mejor_si_sube else -delta
    return "mejoro" if d >= banda else "empeoro" if d <= -banda else "igual"


def impacto_conversacion(prod: Iterable[tuple[date, int, int]], fecha: date, hasta: date) -> dict[str, Any]:
    pd = {d: v for d, v in _por_dia(prod).items() if v[0] > 0}
    antes, despues = ventanas(pd, fecha, hasta)

    def pct(ds: list[date]) -> tuple[float | None, float]:
        login = sum(pd[d][0] for d in ds)
        conv = sum(pd[d][1] for d in ds)
        return (round(conv / login * 100, 1) if login >= MIN_HORAS * 3600 else None), round(login / 3600, 1)

    a, ha = pct(antes)
    d, hd = pct(despues)
    delta = round(d - a, 1) if a is not None and d is not None else None
    return {"metrica": "conversacion", "unidad": "%", "antes": _lado(antes, valor=a, horas=ha),
            "despues": _lado(despues, valor=d, horas=hd), "delta": delta, "resultado": _resultado(delta, BANDA_PP),
            "banda": BANDA_PP, "completo": len(despues) >= VENTANA,
            "detalle": f"% de conversación de {VENTANA} días con conexión antes y {VENTANA} después."}


def impacto_ventas(producto: str, prod: Iterable[tuple[date, int, int]], netas_dia: dict[date, int], fecha: date,
                   hasta: date, maduras_hasta: date | None) -> dict[str, Any]:
    """`maduras_hasta`: último día de venta con las activaciones ya maduras (None: sin informes de ventas)."""
    pd = {d: v for d, v in _por_dia(prod).items() if v[0] > 0}
    maduros = [d for d in pd if maduras_hasta and d <= maduras_hasta]  # sin ventas maduras no hay ventanas
    antes, despues = ventanas(maduros, fecha, hasta)

    def tasa(ds: list[date]) -> tuple[float | None, int, float]:
        horas = sum(pd[d][0] for d in ds) / 3600
        netas = sum(netas_dia.get(d, 0) for d in ds)
        return (round(netas / horas, 3) if horas >= MIN_HORAS else None), netas, round(horas, 1)

    a, na, ha = tasa(antes)
    d, nd, hd = tasa(despues)
    if a is None or d is None:
        delta = None
    elif a == 0:
        delta = 100.0 if d > 0 else 0.0
    else:
        delta = round((d - a) / a * 100, 1)
    nombre = "Pospago" if producto == "pospago" else "GPON"
    return {"metrica": producto, "unidad": "netas por hora", "antes": _lado(antes, valor=a, netas=na, horas=ha),
            "despues": _lado(despues, valor=d, netas=nd, horas=hd), "delta": delta,
            "resultado": _resultado(delta, BANDA_REL), "banda": BANDA_REL, "completo": len(despues) >= VENTANA,
            "maduras_hasta": maduras_hasta.isoformat() if maduras_hasta else None,
            "detalle": f"Netas {nombre} por hora conectada en {VENTANA} días antes y {VENTANA} después "
                       f"(del después, solo los días con las activaciones maduras: {DIAS_MADURACION} días)."}


def histograma(lineas: Iterable[tuple[int | None, bool]]) -> dict[str, list[int]]:
    """Pospago por antigüedad: (días desde la activación al corte, sin uso) → {edad: [líneas, sin uso]}.

    Solo las de 3 a 21 días: antes están «en espera» y después ya no se comparan."""
    out: dict[str, list[int]] = {}
    for edad, sin_uso in lineas:
        if edad is None or not EDAD_MIN <= edad <= EDAD_MAX:
            continue
        h = out.setdefault(str(edad), [0, 0])
        h[0] += 1
        h[1] += bool(sin_uso)
    return dict(sorted(out.items(), key=lambda kv: int(kv[0])))


def impacto_uso(antes: dict[str, list[int]] | None, despues: dict[str, list[int]], edad_max: int,
                corte_antes: str | None, corte_despues: str | None) -> dict[str, Any]:
    """`antes`: la foto al registrar el coaching. `despues`: las vendidas después, del informe actual.
    `edad_max`: la antigüedad que ya pudieron alcanzar las vendidas después (corte − día siguiente al coaching)."""
    tope = min(EDAD_MAX, edad_max)

    def suma(h: dict[str, list[int]] | None) -> tuple[int, int]:
        filas = [v for k, v in (h or {}).items() if EDAD_MIN <= int(k) <= tope]
        return sum(v[0] for v in filas), sum(v[1] for v in filas)

    la, sa = suma(antes)
    ld, sd = suma(despues)
    a = round(sa / la * 100, 1) if la >= MIN_LINEAS else None
    d = round(sd / ld * 100, 1) if ld >= MIN_LINEAS else None
    delta = round(d - a, 1) if a is not None and d is not None else None
    if antes is None:
        detalle = "Sin foto de las líneas al registrar el coaching: no hay con qué comparar."
    elif tope < EDAD_MIN:
        detalle = f"Las líneas vendidas después todavía no tienen {EDAD_MIN} días de activadas."
    else:
        detalle = (f"Pospago vendidas antes y después del coaching, con la misma antigüedad: de {EDAD_MIN} a {tope} días "
                   "de activadas.")
    return {"metrica": "uso", "unidad": "% sin uso",
            "antes": {"valor": a, "lineas": la, "sin_uso": sa, "corte": corte_antes},
            "despues": {"valor": d, "lineas": ld, "sin_uso": sd, "corte": corte_despues},
            "edades": [EDAD_MIN, tope] if tope >= EDAD_MIN else None,
            "delta": delta, "resultado": _resultado(delta, BANDA_USO_PP, mejor_si_sube=False), "banda": BANDA_USO_PP,
            "completo": edad_max >= EDAD_MAX, "detalle": detalle}


def sin_medicion(metrica: str = "otra", motivo: str | None = None) -> dict[str, Any]:
    return {"metrica": metrica, "resultado": "sin_datos", "delta": None, "completo": True,
            "detalle": motivo or "Métrica sin medición automática: vale el comentario del seguimiento."}
