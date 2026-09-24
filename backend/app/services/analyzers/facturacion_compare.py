"""Comparación de N liquidaciones de Televentas Claro (Facturación).

Recibe varios reportes ya procesados (su `data` de `analyze_facturacion`) y arma:
- matriz Concepto × mes (todas las descripciones),
- totales/créditos/débitos/ventas por mes,
- variaciones mes a mes,
- panel de drivers clave,
- hallazgos automáticos.

Solo trabaja sobre datos ya persistidos (liviano): no re-parsea archivos.
"""
from __future__ import annotations

from typing import Any

# Drivers operativos clave a destacar en el panel
_DRIVERS = [
    ("INCENTIVO PRODUCTIVIDAD", "Bono (incentivo productividad)"),
    ("SUSPENSIONES", "Suspensiones"),
    ("LINEA CON DOCUMENTACION FALTANTE", "Documentación faltante"),
    ("ACTIVACIONES", "Activaciones (ventas)"),
]


def _label(rep: dict[str, Any]) -> str:
    return rep.get("title") or rep.get("periodo") or f"Liq {rep.get('nro_liquidacion') or '?'}"


def _fecha_key(fecha: str) -> str:
    f = (fecha or "").strip()
    if len(f) >= 10 and f[2] == "/" and f[5] == "/":
        return f"{f[6:10]}-{f[3:5]}-{f[0:2]}"
    return f


_MADURACION_MESES = 2  # una venta tarda ~2 meses en que aparezcan sus penalidades (chargeback)


def _mes_de_fecha(fecha: str) -> str:
    k = _fecha_key(fecha)  # yyyy-mm-dd
    return k[:7] if len(k) >= 7 else ""


def _resta_meses(periodo: str, n: int) -> str:
    """`yyyy-mm` menos n meses."""
    try:
        y, m = int(periodo[:4]), int(periodo[5:7])
    except (ValueError, IndexError):
        return periodo
    idx = (y * 12 + (m - 1)) - n
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}"


def calidad_por_fecha(reports: list[dict[str, Any]], min_act: int = 5) -> dict[str, Any]:
    """Cruza, ENTRE liquidaciones, las activaciones por fecha de venta contra las penalidades
    (suspensiones PFI + documentación + cancelaciones) de esa misma fecha → tasa de penalidad.
    Fechas con tasa baja = ventas de MAYOR calidad; tasa alta = MENOR calidad.

    Solo se rankean las cohortes MADURAS (con ~2 meses para que asomen sus penalidades). Las
    fechas más recientes se devuelven aparte (inmaduras) para no inflar la calidad artificialmente.
    """
    from collections import defaultdict
    ventas: dict[str, list] = defaultdict(lambda: [0, 0.0])
    penal: dict[str, list] = defaultdict(lambda: [0, 0.0])
    for r in reports:
        ch = (r.get("data") or {}).get("cohorte_calidad", {})
        for f, v in (ch.get("ventas_por_dia") or {}).items():
            ventas[f][0] += v[0]; ventas[f][1] += v[1]
        for f, v in (ch.get("penal_por_dia") or {}).items():
            penal[f][0] += v[0]; penal[f][1] += v[1]

    # Período más reciente entre las liquidaciones → corte de madurez
    periodos = [p for p in (r.get("periodo") for r in reports) if p]
    ultimo_periodo = max(periodos) if periodos else ""
    corte_maduro = _resta_meses(ultimo_periodo, _MADURACION_MESES) if ultimo_periodo else ""

    filas, inmaduras = [], []
    for f, va in ventas.items():
        act = va[0]
        if act < min_act:
            continue
        pen = penal.get(f, [0, 0.0])
        fila = {
            "fecha": f,
            "activaciones": act,
            "penalidades": pen[0],
            "monto_penalidad": round(pen[1], 2),
            "tasa_penalidad": round(pen[0] / act * 100, 1) if act else 0.0,
            "maduro": (not corte_maduro) or _mes_de_fecha(f) <= corte_maduro,
        }
        (filas if fila["maduro"] else inmaduras).append(fila)
    if not filas and not inmaduras:
        return {"sin_datos": True, "mensaje": "Necesito al menos 2 liquidaciones para cruzar calidad por fecha."}
    filas.sort(key=lambda x: _fecha_key(x["fecha"]))
    inmaduras.sort(key=lambda x: _fecha_key(x["fecha"]))
    peor = sorted(filas, key=lambda x: -x["tasa_penalidad"])[:8]
    mejor = sorted(filas, key=lambda x: x["tasa_penalidad"])[:8]
    return {
        "por_fecha": filas,
        "inmaduras": inmaduras,           # cohortes recientes, aún sin penalidades maduradas
        "menor_calidad": peor,            # mayor tasa de penalidad
        "mayor_calidad": mejor,           # menor tasa de penalidad
        "corte_maduro": corte_maduro,     # solo se rankea hasta este mes (inclusive)
        "nota": f"Ranking sobre cohortes con ~{_MADURACION_MESES} meses de maduración (hasta {corte_maduro}). "
                f"Las fechas posteriores se listan en 'inmaduras' y aún no reflejan sus penalidades.",
    }


def _sort_key(rep: dict[str, Any]):
    return (rep.get("periodo") or "", rep.get("generated_at") or "")


def compare_facturacion(reports: list[dict[str, Any]]) -> dict[str, Any]:
    """`reports`: lista de {id, title, periodo, nro_liquidacion, generated_at, data}."""
    reps = sorted(reports, key=_sort_key)
    cols = [
        {
            "id": r["id"],
            "label": _label(r),
            "periodo": r.get("periodo"),
            "nro_liquidacion": r.get("nro_liquidacion"),
        }
        for r in reps
    ]

    # Mapa concepto -> {col_id: importe} (todas las descripciones)
    conceptos_union: dict[str, dict[str, float]] = {}
    for r in reps:
        for c in (r.get("data") or {}).get("conceptos", []):
            conceptos_union.setdefault(c["descripcion"], {})[r["id"]] = c["importe"]

    def row_for(desc: str) -> dict[str, Any]:
        valores = conceptos_union.get(desc, {})
        return {
            "descripcion": desc,
            "valores": [round(valores.get(col["id"], 0.0), 2) for col in cols],
        }

    # Orden de conceptos por |importe| del último mes
    last_id = cols[-1]["id"] if cols else None
    conceptos_orden = sorted(
        conceptos_union.keys(),
        key=lambda d: abs(conceptos_union[d].get(last_id, 0.0)),
        reverse=True,
    )
    conceptos_matrix = [row_for(d) for d in conceptos_orden]

    # Totales por mes
    def kpi(r: dict, key: str) -> float:
        return (r.get("data") or {}).get("kpis", {}).get(key, 0.0)

    totales = [round(kpi(r, "total"), 2) for r in reps]
    creditos = [round(kpi(r, "creditos"), 2) for r in reps]
    debitos = [round(kpi(r, "debitos"), 2) for r in reps]
    ventas = [int(kpi(r, "ventas_activaciones") or 0) for r in reps]

    # Variaciones mes a mes (sobre el total)
    variaciones = [None]
    for i in range(1, len(totales)):
        prev, cur = totales[i - 1], totales[i]
        variaciones.append(round((cur / prev - 1) * 100, 1) if prev else None)

    # Panel de drivers
    drivers = []
    for desc, nombre in _DRIVERS:
        vals = conceptos_union.get(desc)
        if not vals:
            continue
        drivers.append({
            "concepto": desc,
            "nombre": nombre,
            "valores": [round(vals.get(col["id"], 0.0), 2) for col in cols],
        })

    # Descomposición del cambio: último mes vs anterior (delta por concepto)
    descomposicion: list[dict[str, Any]] = []
    delta_total = 0.0
    if len(cols) >= 2:
        prev_id, last_id2 = cols[-2]["id"], cols[-1]["id"]
        delta_total = round(totales[-1] - totales[-2], 2)
        for desc, vals in conceptos_union.items():
            a = vals.get(prev_id, 0.0)
            b = vals.get(last_id2, 0.0)
            d = round(b - a, 2)
            if abs(d) < 1:
                continue
            descomposicion.append({
                "descripcion": desc,
                "anterior": round(a, 2),
                "ultimo": round(b, 2),
                "delta": d,
                "pct_del_cambio": round(d / delta_total * 100, 1) if delta_total else 0.0,
            })
        descomposicion.sort(key=lambda x: x["delta"])  # más negativos primero

    # Hallazgos automáticos (deterministas)
    hallazgos: list[str] = []
    if len(totales) >= 2:
        promedio = sum(totales) / len(totales)
        ultimo = totales[-1]
        delta = ultimo - promedio
        hallazgos.append(
            f"Promedio del período: Gs {promedio:,.0f}. Último mes ({cols[-1]['label']}): "
            f"Gs {ultimo:,.0f} ({delta:+,.0f} vs promedio).".replace(",", ".")
        )
        # Mayor variación mes a mes
        var_validas = [(i, v) for i, v in enumerate(variaciones) if v is not None]
        if var_validas:
            i_max = max(var_validas, key=lambda x: abs(x[1]))
            hallazgos.append(
                f"Mayor variación: {cols[i_max[0]]['label']} ({i_max[1]:+.1f}% vs mes previo)."
            )

    return {
        "columnas": cols,
        "conceptos": conceptos_matrix,   # matriz completa (todas las descripciones)
        "totales": totales,
        "creditos": creditos,
        "debitos": debitos,
        "ventas": ventas,
        "variaciones": variaciones,
        "drivers": drivers,
        "descomposicion": descomposicion,   # delta por concepto (último vs anterior)
        "delta_total": delta_total,
        "hallazgos": hallazgos,
    }
