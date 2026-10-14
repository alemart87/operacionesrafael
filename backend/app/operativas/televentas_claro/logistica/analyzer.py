"""Análisis del corte de pedidos de logística.

Todo lo que la pantalla muestra sale de acá y queda congelado en el informe (`data`):
- `kpis`: totales por estado y porcentajes, pendientes y su demora.
- `por_region` / `por_departamento` / `por_ciudad`: cantidad y % por estado en cada zona (las tablas del modelo).
- `motivos`: motivo × región, para todos los pedidos y para cada estado (el filtro dinámico por estado).
- `serie`: la línea de tiempo por fecha de venta: pedidos del día y acumulado, por estado.
- `pendientes`: los pedidos EN GESTION con su demora (días desde la venta hasta el corte), por zona y en tramos.
- `vendedores`, `promociones`: el mismo desglose por estado.
- `pedidos`: el detalle completo (una fila por pedido, con su demora) para la tabla con filtro y búsqueda.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date
from typing import Any

from .parser import DEVUELTO, EN_GESTION, ENTREGADO, ESTADOS
from .proyeccion import proyectar

VERSION_ANALISIS = 2
TRAMOS = (("0-2", 0, 2), ("3-5", 3, 5), ("6-10", 6, 10), ("11+", 11, 10**6))
REGIONES_ORDEN = ("CENTRAL", "INTERIOR")
MAX_CIUDADES = 20


def _pct(a: int, b: int) -> float | None:
    return round(a * 100 / b, 1) if b else None


def _orden_estados(filas: list[dict[str, Any]]) -> list[str]:
    otros = sorted({f["estado"] for f in filas} - set(ESTADOS))
    return [*ESTADOS, *otros]


def _orden_regiones(filas: list[dict[str, Any]]) -> list[str]:
    vistas = {f["region"] for f in filas}
    return [r for r in REGIONES_ORDEN if r in vistas] + sorted(vistas - set(REGIONES_ORDEN))


def _desglose(filas: list[dict[str, Any]], clave: str, estados: list[str], extra: dict[str, str] | None = None,
              orden: list[str] | None = None, tope: int | None = None) -> list[dict[str, Any]]:
    """Una fila por valor de `clave` con el total y la cantidad y % de cada estado."""
    grupos: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for f in filas:
        grupos[f.get(clave) or "—"].append(f)
    claves = orden or sorted(grupos, key=lambda k: (-len(grupos[k]), k))
    out = []
    for k in claves[: tope or None]:
        g = grupos.get(k, [])
        c = Counter(f["estado"] for f in g)
        fila = {clave: k, "total": len(g), "estados": {e: c.get(e, 0) for e in estados},
                "pct": {e: _pct(c.get(e, 0), len(g)) for e in estados}}
        if extra:
            fila.update({a: next((f.get(b) for f in g if f.get(b)), None) for a, b in extra.items()})
        out.append(fila)
    return out


def _tramo(dias: int) -> str:
    for nombre, a, b in TRAMOS:
        if a <= dias <= b:
            return nombre
    return TRAMOS[-1][0]


def _demora(dias_lista: list[int]) -> dict[str, Any]:
    tramos = Counter(_tramo(d) for d in dias_lista)
    return {"n": len(dias_lista), "dias_prom": round(sum(dias_lista) / len(dias_lista), 1) if dias_lista else None,
            "dias_max": max(dias_lista) if dias_lista else None, "tramos": {t[0]: tramos.get(t[0], 0) for t in TRAMOS}}


def analizar(filas: list[dict[str, Any]], fecha_corte: date) -> dict[str, Any]:
    estados = _orden_estados(filas)
    regiones = _orden_regiones(filas)
    corte = fecha_corte.isoformat()
    pedidos: list[dict[str, Any]] = []
    for f in filas:
        venta = date.fromisoformat(f["fecha"])
        dias = max(0, (fecha_corte - venta).days)
        pedidos.append({**f, "dias": dias, "tramo": _tramo(dias)})
    pedidos.sort(key=lambda p: (p["fecha"], p["region"], p["cliente"] or ""))

    total = len(pedidos)
    por_estado = Counter(p["estado"] for p in pedidos)
    pendientes = [p for p in pedidos if p["estado"] == EN_GESTION]
    dias_pend = [p["dias"] for p in pendientes]

    # Período: el mes con más pedidos (un corte cruza de mes alguna vez).
    meses = Counter(p["fecha"][:7] for p in pedidos)
    periodo = meses.most_common(1)[0][0]
    fechas = sorted({p["fecha"] for p in pedidos})

    kpis = {
        "pedidos": total, "fecha_corte": corte, "desde": fechas[0], "hasta": fechas[-1], "dias": len(fechas),
        "por_estado": {e: {"n": por_estado.get(e, 0), "pct": _pct(por_estado.get(e, 0), total)} for e in estados},
        "entregados": por_estado.get(ENTREGADO, 0), "en_gestion": por_estado.get(EN_GESTION, 0), "devueltos": por_estado.get(DEVUELTO, 0),
        "pct_entregados": _pct(por_estado.get(ENTREGADO, 0), total), "pct_en_gestion": _pct(por_estado.get(EN_GESTION, 0), total),
        "pct_devueltos": _pct(por_estado.get(DEVUELTO, 0), total),
        "demora": _demora(dias_pend), "vendedores": len({p["vendedor"] for p in pedidos if p["vendedor"]}),
        "regiones": len(regiones), "fuera_de_periodo": sum(n for m, n in meses.items() if m != periodo),
    }

    # Motivos × región: para todos y para cada estado.
    def motivos_de(subset: list[dict[str, Any]]) -> list[dict[str, Any]]:
        grupos: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for p in subset:
            grupos[p["motivo"]].append(p)
        out = []
        for m, g in sorted(grupos.items(), key=lambda kv: (-len(kv[1]), kv[0])):
            c = Counter(p["region"] for p in g)
            out.append({"motivo": m, "total": len(g), "regiones": {r: c.get(r, 0) for r in regiones}, "pct": _pct(len(g), len(subset))})
        return out
    motivos = {"todos": motivos_de(pedidos), **{e: motivos_de([p for p in pedidos if p["estado"] == e]) for e in estados}}

    # Línea de tiempo por fecha de venta: del día y acumulado, por estado.
    serie = []
    acum: Counter = Counter()
    por_fecha: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for p in pedidos:
        por_fecha[p["fecha"]].append(p)
    for fch in fechas:
        c = Counter(p["estado"] for p in por_fecha[fch])
        acum.update(c)
        serie.append({"fecha": fch, "total": len(por_fecha[fch]), "estados": {e: c.get(e, 0) for e in estados},
                      "acumulado": {e: acum.get(e, 0) for e in estados}, "acumulado_total": sum(acum.values()),
                      "pendientes_dias_prom": (round(sum(p["dias"] for p in por_fecha[fch] if p["estado"] == EN_GESTION)
                                                     / c[EN_GESTION], 1) if c.get(EN_GESTION) else None)})

    # Pendientes (EN GESTION) por zona: región → departamento, con la demora en tramos.
    por_zona = []
    for r in regiones:
        pr = [p for p in pendientes if p["region"] == r]
        if not pr:
            continue
        deptos = []
        for d, g in sorted(defaultdict(list, _agrupar(pr, "departamento")).items(), key=lambda kv: (-len(kv[1]), kv[0])):
            deptos.append({"departamento": d, **_demora([p["dias"] for p in g]),
                           "ciudades": [{"ciudad": c, **_demora([p["dias"] for p in gc])}
                                        for c, gc in sorted(_agrupar(g, "ciudad").items(), key=lambda kv: (-len(kv[1]), kv[0]))]})
        por_zona.append({"region": r, **_demora([p["dias"] for p in pr]), "departamentos": deptos})
    motivos_pend = Counter(p["motivo"] for p in pendientes)
    pendientes_out = {
        **_demora(dias_pend), "por_zona": por_zona,
        "por_motivo": [{"motivo": m, "n": n, "dias_prom": round(sum(p["dias"] for p in pendientes if p["motivo"] == m) / n, 1)}
                       for m, n in motivos_pend.most_common()],
        "lista": sorted(({k: p.get(k) for k in ("formulario", "cliente", "documento", "ciudad", "departamento", "region", "fecha",
                                                 "dias", "tramo", "vendedor", "motivo", "promocion", "linea")} for p in pendientes),
                        key=lambda p: (-p["dias"], p["region"], p["cliente"] or "")),
        "vencidos_6": sum(1 for d in dias_pend if d >= 6), "vencidos_11": sum(1 for d in dias_pend if d >= 11),
    }

    avisos: list[str] = []
    repetidos = [k for k, n in Counter(p["formulario"] for p in pedidos if p["formulario"]).items() if n > 1]
    if repetidos:
        avisos.append(f"{len(repetidos)} formulario(s) aparecen más de una vez (varias líneas del mismo pedido): "
                      + ", ".join(sorted(repetidos)[:5]) + ("…" if len(repetidos) > 5 else "") + ". Se cuentan como filas.")
    sin_motivo = sum(1 for p in pedidos if not p.get("motivo_informado"))
    if sin_motivo:
        avisos.append(f"{sin_motivo} pedido(s) sin motivo informado: se tomó el estado como motivo.")
    raros = sorted({p["estado"] for p in pedidos} - set(ESTADOS))
    if raros:
        avisos.append("Estados fuera del modelo (ENTREGADO · EN GESTION · DEVUELTO): " + ", ".join(raros) + ".")
    if kpis["fuera_de_periodo"]:
        avisos.append(f"{kpis['fuera_de_periodo']} pedido(s) con fecha de venta fuera de {periodo}: se incluyen en este corte.")
    sin_region = sum(1 for p in pedidos if p["region"] == "SIN REGION")
    if sin_region:
        avisos.append(f"{sin_region} pedido(s) sin región.")

    return {
        "version": VERSION_ANALISIS, "periodo": periodo, "fecha_corte": corte, "estados": estados, "regiones": regiones,
        "kpis": kpis, "proyeccion": proyectar(pedidos, periodo, kpis["pct_entregados"]),
        "por_region": _desglose(pedidos, "region", estados, orden=regiones),
        "por_departamento": _desglose(pedidos, "departamento", estados, extra={"region": "region"}),
        "por_ciudad": _desglose(pedidos, "ciudad", estados, extra={"region": "region", "departamento": "departamento"}, tope=MAX_CIUDADES),
        "motivos": motivos, "serie": serie, "pendientes": pendientes_out,
        "vendedores": _desglose(pedidos, "vendedor", estados),
        "promociones": _desglose(pedidos, "promocion", estados),
        "pedidos": pedidos, "avisos": avisos,
    }


def _agrupar(filas: list[dict[str, Any]], clave: str) -> dict[str, list[dict[str, Any]]]:
    g: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for f in filas:
        g[f.get(clave) or "—"].append(f)
    return g


def resumen_para_modelo(data: dict[str, Any]) -> dict[str, Any]:
    k = data["kpis"]
    regiones = {z["region"]: {"n": z["n"], "dias_prom": z["dias_prom"], "dias_max": z["dias_max"],
                              "vencidos_6": sum(v for t, v in z["tramos"].items() if t in ("6-10", "11+"))}
                for z in data["pendientes"]["por_zona"]}
    for r in data["regiones"]:
        regiones.setdefault(r, {"n": 0, "dias_prom": None, "dias_max": None, "vencidos_6": 0})
    return {"pedidos": k["pedidos"], "entregados": k["entregados"], "en_gestion": k["en_gestion"], "devueltos": k["devueltos"],
            "pct_entregados": k["pct_entregados"] or 0.0, "demora_prom": k["demora"]["dias_prom"], "demora_max": k["demora"]["dias_max"],
            "demora_regiones": regiones, "fecha_dato": k["hasta"], "periodo": data["periodo"], "version": data["version"],
            "proyeccion": (data.get("proyeccion") or {}).get("proyeccion")}
