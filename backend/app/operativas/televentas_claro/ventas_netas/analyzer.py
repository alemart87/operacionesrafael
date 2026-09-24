"""Análisis del corte de Ventas Netas (Televentas Claro).

Reglas acordadas con el negocio:
* Netas = líneas de la hoja DDI (ventas ya finalizadas y activadas) cuyo mes de
  activación es el período del informe. Las líneas suspendidas y las portaciones
  que no llegaron a DDI se cuentan y se marcan, pero no se descartan, para que
  el total coincida con el reporte de Claro.
* El período es el mes de la fecha de activación/venta (no de la carga). Se toma
  el mes mayoritario; lo que queda fuera se informa aparte.
* Uso: `CONSUMO_DATOS` (SI/NO) solo aplica a Pospago. Una línea sin uso es una
  alerta de posible PFI (primera factura impaga).
* Vendedor de una neta = `POS_NOMBRE` (sin el prefijo del subcanal). Las cargas
  pendientes no traen POS: se atribuyen por `VENDEDOR_LEGAJO`.
* Alerta de vendedor: al menos MIN_LINEAS_ALERTA Pospago y menos de UMBRAL_USO_PCT en uso.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import date
from typing import Any

UMBRAL_USO_PCT = 50.0
MIN_LINEAS_ALERTA = 5
ESTADO_FINALIZADA = "Vta_Finalizada"
RANGOS_ANTIGUEDAD = [("0-2 días", 0, 2), ("3-7 días", 3, 7), ("8-15 días", 8, 15), ("más de 15 días", 16, None)]

_PREFIJO_SUBCANAL = re.compile(r"^\s*([A-Z/]{2,5})\s*-\s*")


def _pct(parte: float, total: float) -> float:
    return round(parte / total * 100, 1) if total else 0.0


def _mes(fecha: str | None) -> str | None:
    return fecha[:7] if fecha and len(fecha) >= 7 else None


def _to_date(s: str | None) -> date | None:
    try:
        return date.fromisoformat(s) if s else None
    except ValueError:
        return None


def vendedor_de(pos_nombre: str | None, subcanal: str | None) -> tuple[str, str | None]:
    """'TKM -  DOLLY GONZALEZ' -> ('DOLLY GONZALEZ', 'TKM'). Sin POS -> ('SIN VENDEDOR', subcanal)."""
    if not pos_nombre:
        return "SIN VENDEDOR", subcanal
    m = _PREFIJO_SUBCANAL.match(pos_nombre)
    nombre = pos_nombre[m.end():] if m else pos_nombre
    nombre = re.sub(r"\s+", " ", nombre).strip().upper() or "SIN VENDEDOR"
    # El prefijo del POS es el subcanal real del vendedor; la columna SUBCANAL es el respaldo.
    return nombre, ((m.group(1) if m else None) or subcanal)


def _rango_antiguedad(dias: int) -> str:
    for label, lo, hi in RANGOS_ANTIGUEDAD:
        if dias >= lo and (hi is None or dias <= hi):
            return label
    return RANGOS_ANTIGUEDAD[0][0]


def detectar_periodo(parsed: dict[str, Any]) -> str | None:
    meses: Counter = Counter()
    for r in parsed.get("ddi", []):
        if (m := _mes(r.get("fecha_activacion"))):
            meses[m] += 1
    for r in parsed.get("cargas", []):
        if r.get("sds_estado") == ESTADO_FINALIZADA and (m := _mes(r.get("sds_fecha_venta"))):
            meses[m] += 1
    return meses.most_common(1)[0][0] if meses else None


def analyze_ventas_netas(parsed: dict[str, Any]) -> dict[str, Any]:
    periodo = detectar_periodo(parsed)
    if not periodo:
        raise ValueError("No se pudo detectar el período: el archivo no tiene fechas de activación ni de venta.")

    ddi_all = parsed.get("ddi", [])
    cargas_all = parsed.get("cargas", [])
    por_all = parsed.get("portabilidad", [])

    fechas_dato = [d for r in cargas_all if (d := _to_date(r.get("fecha_dato")))]
    fecha_dato = max(fechas_dato) if fechas_dato else max(
        (d for r in ddi_all if (d := _to_date(r.get("fecha_activacion")))), default=None
    )

    # ---- Netas del período (DDI) ----
    ddi = [r for r in ddi_all if _mes(r.get("fecha_activacion")) == periodo]
    fuera_periodo_ddi = len(ddi_all) - len(ddi)

    prod = Counter(r.get("tipo_producto") or "SIN PRODUCTO" for r in ddi)
    pospago = [r for r in ddi if r.get("tipo_producto") == "Pospago"]
    sin_uso = [r for r in pospago if r.get("consumo_datos") != "SI"]
    portadas = [r for r in ddi if r.get("portacion") == "SI"]
    suspendidas = [r for r in ddi if r.get("linea_estado_cierre") == "S"]

    def uso_stats(rows: list[dict]) -> dict[str, Any]:
        pp = [r for r in rows if r.get("tipo_producto") == "Pospago"]
        su = sum(1 for r in pp if r.get("consumo_datos") != "SI")
        return {"total": len(rows), "pospago": len(pp), "sin_uso": su, "con_uso": len(pp) - su,
                "pct_uso": _pct(len(pp) - su, len(pp)), "pct_sin_uso": _pct(su, len(pp))}

    def agrupar(rows: list[dict], key, label: str, orden_por_total: bool = True) -> list[dict]:
        grupos: dict[Any, list[dict]] = defaultdict(list)
        for r in rows:
            grupos[key(r) or "—"].append(r)
        out = [{label: k, **uso_stats(v)} for k, v in grupos.items()]
        out.sort(key=(lambda x: -x["total"]) if orden_por_total else (lambda x: str(x[label])))
        return out

    por_producto = agrupar(ddi, lambda r: r.get("tipo_producto"), "producto")
    por_plan = agrupar(ddi, lambda r: f"{r.get('tipo_producto')} · {r.get('plan_descripcion')}", "plan")
    for p in por_plan:
        p["producto"] = p["plan"].split(" · ")[0]
        p["plan"] = p["plan"].split(" · ", 1)[1] if " · " in p["plan"] else p["plan"]
    por_dia = agrupar(ddi, lambda r: r.get("fecha_activacion"), "dia", orden_por_total=False)
    por_origen = agrupar(portadas, lambda r: r.get("origen_portacion"), "origen")
    por_tipo_port = agrupar(ddi, lambda r: "Portación" if r.get("portacion") == "SI" else "Nativa", "tipo")
    por_segmento = agrupar(ddi, lambda r: r.get("cliente_segmento"), "segmento")
    por_subcanal = agrupar(ddi, lambda r: vendedor_de(r.get("pos_nombre"), r.get("subcanal"))[1], "subcanal")
    por_ciudad = agrupar(ddi, lambda r: r.get("ciudad"), "ciudad")[:15]

    # ---- Vendedores (tabla operativa) ----
    vend: dict[str, dict[str, Any]] = {}
    for r in ddi:
        nombre, subcanal = vendedor_de(r.get("pos_nombre"), r.get("subcanal"))
        v = vend.setdefault(nombre, {"vendedor": nombre, "subcanal": subcanal, "pos_id": r.get("pos_id"),
                                     "pospago": 0, "sin_uso": 0, "con_uso": 0, "gpon": 0, "iptv": 0,
                                     "otros": 0, "total": 0, "portadas": 0, "suspendidas": 0})
        v["total"] += 1
        if r.get("portacion") == "SI":
            v["portadas"] += 1
        if r.get("linea_estado_cierre") == "S":
            v["suspendidas"] += 1
        p = r.get("tipo_producto")
        if p == "Pospago":
            v["pospago"] += 1
            v["con_uso" if r.get("consumo_datos") == "SI" else "sin_uso"] += 1
        elif p == "GPON":
            v["gpon"] += 1
        elif p == "IPTV":
            v["iptv"] += 1
        else:
            v["otros"] += 1
    vendedores = []
    for v in vend.values():
        v["pct_uso"] = _pct(v["con_uso"], v["pospago"])
        v["pct_sin_uso"] = _pct(v["sin_uso"], v["pospago"])
        v["alerta"] = v["pospago"] >= MIN_LINEAS_ALERTA and v["pct_uso"] < UMBRAL_USO_PCT
        vendedores.append(v)
    vendedores.sort(key=lambda v: (-v["total"], v["vendedor"]))
    alertas = sorted((v for v in vendedores if v["alerta"]), key=lambda v: (v["pct_uso"], -v["pospago"]))

    # ---- Portaciones que no llegaron a DDI (PORTABILIDAD) ----
    sds_ddi = {r["sds_number"] for r in ddi_all}
    por_fuera = [r for r in por_all if r["sds_number"] not in sds_ddi]
    fuera_de_netas = {
        "total": len(por_fuera),
        "sin_uso": sum(1 for r in por_fuera if r.get("consumo_datos") != "SI"),
        "por_tipo": [{"tipo": k, "total": n} for k, n in Counter(r.get("portacion_tipo") or "—" for r in por_fuera).most_common()],
        "detalle": [_detalle_neta(r, "PORTABILIDAD") for r in por_fuera],
    }

    # ---- Cargas: pendientes y resumen ----
    cargas = [r for r in cargas_all if _mes(r.get("sds_fecha_alta_venta")) == periodo
              or _mes(r.get("sds_fecha_venta")) == periodo]
    finalizadas = [r for r in cargas if r.get("sds_estado") == ESTADO_FINALIZADA]
    pend = [r for r in cargas if r.get("sds_estado") != ESTADO_FINALIZADA]
    sds_netas = {r["sds_number"] for r in ddi} | {r["sds_number"] for r in por_all}
    finalizadas_sin_activar = [r for r in finalizadas if r["sds_number"] not in sds_netas]

    detalle_pend = []
    for r in pend:
        alta = _to_date(r.get("sds_fecha_alta_venta"))
        dias = (fecha_dato - alta).days if (fecha_dato and alta) else None
        detalle_pend.append({
            "sds_number": r["sds_number"],
            "fecha_alta": r.get("sds_fecha_alta_venta"),
            "dias": dias,
            "antiguedad": _rango_antiguedad(dias) if dias is not None else "—",
            "estado": r.get("sds_estado"),
            "cancelacion_adm": r.get("sds_canc_adm"),
            "producto": r.get("tipo_producto"),
            "plan": r.get("plan_descripcion_orig"),
            "campania": r.get("campania_descripcion"),
            "portacion": "SI" if (r.get("tipo_port") or "NO") != "NO" else "NO",
            "tipo_port": r.get("tipo_port"),
            "origen_portacion": r.get("origen_portacion"),
            "riesgo": r.get("riesgo_ori"),
            "legajo": r.get("vendedor_legajo"),
            "cargado_por": " ".join(x for x in (r.get("vendedor_nombre"), r.get("vendedor_apellido")) if x) or None,
            "vendedor": vendedor_de(r.get("pos_nombre"), r.get("subcanal"))[0] if r.get("pos_nombre") else None,
            "ciudad": r.get("ciudad_fact"),
            "comentario": r.get("comentario"),
        })
    detalle_pend.sort(key=lambda x: (-(x["dias"] or 0), x["sds_number"]))

    estados = [e for e, _ in Counter(x["estado"] for x in detalle_pend).most_common()]
    por_antiguedad = []
    for label, _, _ in RANGOS_ANTIGUEDAD:
        fila = {"rango": label, "total": 0}
        for e in estados:
            fila[e] = 0
        for x in detalle_pend:
            if x["antiguedad"] == label:
                fila["total"] += 1
                fila[x["estado"]] += 1
        por_antiguedad.append(fila)
    por_legajo: dict[str, dict] = {}
    for x in detalle_pend:
        k = x["legajo"] or "—"
        f = por_legajo.setdefault(k, {"legajo": k, "cargado_por": x["cargado_por"], "total": 0, "mas_de_7_dias": 0})
        f["total"] += 1
        if (x["dias"] or 0) > 7:
            f["mas_de_7_dias"] += 1
    pendientes = {
        "total": len(pend),
        "portacion": sum(1 for x in detalle_pend if x["portacion"] == "SI"),
        "estados": estados,
        "por_estado": [{"estado": e, "total": n} for e, n in Counter(x["estado"] for x in detalle_pend).most_common()],
        "por_antiguedad": por_antiguedad,
        "por_legajo": sorted(por_legajo.values(), key=lambda f: -f["total"]),
        "mas_de_7_dias": sum(1 for x in detalle_pend if (x["dias"] or 0) > 7),
        "detalle": detalle_pend,
    }

    kpis = {
        "periodo": periodo,
        "fecha_dato": fecha_dato.isoformat() if fecha_dato else None,
        "netas": len(ddi),
        "pospago": len(pospago),
        "gpon": prod.get("GPON", 0),
        "iptv": prod.get("IPTV", 0),
        "portadas": len(portadas),
        "nativas": len(ddi) - len(portadas),
        "pct_portacion": _pct(len(portadas), len(ddi)),
        "pospago_sin_uso": len(sin_uso),
        "pospago_con_uso": len(pospago) - len(sin_uso),
        "pct_sin_uso": _pct(len(sin_uso), len(pospago)),
        "pct_uso": _pct(len(pospago) - len(sin_uso), len(pospago)),
        "suspendidas": len(suspendidas),
        "fuera_de_netas": len(por_fuera),
        "vendedores": len(vendedores),
        "vendedores_alerta": len(alertas),
        "cargas": len(cargas),
        "cargas_finalizadas": len(finalizadas),
        "finalizadas_sin_activar": len(finalizadas_sin_activar),
        "pendientes": len(pend),
        "pendientes_portacion": pendientes["portacion"],
        "pendientes_mas_de_7_dias": pendientes["mas_de_7_dias"],
        "fuera_periodo": fuera_periodo_ddi + (len(cargas_all) - len(cargas)),
        "umbral_uso_pct": UMBRAL_USO_PCT,
        "min_lineas_alerta": MIN_LINEAS_ALERTA,
    }

    return {
        "kpis": kpis,
        "por_producto": por_producto,
        "por_plan": por_plan,
        "por_dia": por_dia,
        "portacion": {"por_tipo": por_tipo_port, "por_origen": por_origen},
        "por_segmento": por_segmento,
        "por_subcanal": por_subcanal,
        "por_ciudad": por_ciudad,
        "vendedores": vendedores,
        "alertas": alertas,
        "suspendidas": {
            "total": len(suspendidas),
            "por_razon": [{"razon": k, "total": n} for k, n in Counter(r.get("linea_razon_cierre") or "—" for r in suspendidas).most_common()],
        },
        "fuera_de_netas": fuera_de_netas,
        "pendientes": pendientes,
        "finalizadas_sin_activar": [_detalle_carga(r) for r in finalizadas_sin_activar],
        "detalle_netas": [_detalle_neta(r, "DDI") for r in ddi],
        "hojas": parsed.get("hojas", []),
    }


def _detalle_neta(r: dict[str, Any], origen_hoja: str) -> dict[str, Any]:
    nombre, subcanal = vendedor_de(r.get("pos_nombre"), r.get("subcanal"))
    return {
        "sds_number": r["sds_number"],
        "linea": r.get("linea_orig"),
        "fecha_activacion": r.get("fecha_activacion"),
        "producto": r.get("tipo_producto"),
        "plan": r.get("plan_descripcion"),
        "campania": r.get("campania"),
        "portacion": r.get("portacion") or "SI",
        "tipo_port": r.get("portacion_tipo"),
        "origen_portacion": r.get("origen_portacion"),
        "consumo": r.get("consumo_datos") if r.get("tipo_producto") == "Pospago" else None,
        "estado_linea": r.get("linea_estado_cierre"),
        "razon_cierre": r.get("linea_razon_cierre"),
        "vendedor": nombre,
        "subcanal": subcanal,
        "pos_id": r.get("pos_id"),
        "ciudad": r.get("ciudad"),
        "segmento": r.get("cliente_segmento"),
        "total_neto": r.get("total_neto"),
        "hoja": origen_hoja,
    }


def _detalle_carga(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "sds_number": r["sds_number"],
        "fecha_venta": r.get("sds_fecha_venta"),
        "fecha_activacion": r.get("fecha_activacion"),
        "producto": r.get("tipo_producto"),
        "plan": r.get("plan_descripcion_orig"),
        "tipo_port": r.get("tipo_port"),
        "legajo": r.get("vendedor_legajo"),
        "vendedor": vendedor_de(r.get("pos_nombre"), r.get("subcanal"))[0] if r.get("pos_nombre") else None,
    }
