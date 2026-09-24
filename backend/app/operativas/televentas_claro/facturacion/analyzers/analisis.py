"""Análisis de una liquidación mensual de Televentas Claro (Facturación).

Estructura el resultado del parser en un reporte con TODAS las descripciones de
concepto + KPIs + un análisis rápido automático (descriptivo del mes).
"""
from __future__ import annotations

from typing import Any

# Conceptos que representan ventas/comisiones de activación (informativo)
_CONCEPTOS_VENTA = {"ACTIVACIONES", "ACTIVACION PORTABILIDAD NUMERICA"}


def _fmt_gs(v: float) -> str:
    return f"Gs {v:,.0f}".replace(",", ".")


def analyze_facturacion(parsed: dict[str, Any]) -> dict[str, Any]:
    conceptos = parsed["conceptos"]
    total = parsed["total"]
    creditos = parsed["creditos"]
    debitos = parsed["debitos"]
    ventas = parsed["ventas"]
    susp = parsed["suspensiones"]
    doc = parsed["doc_faltante"]

    # Enriquecer cada concepto con tipo y % sobre el total bruto del mismo signo
    conceptos_out = []
    for c in conceptos:
        tipo = "credito" if c["importe"] > 0 else ("debito" if c["importe"] < 0 else "neutro")
        base = creditos if c["importe"] > 0 else (debitos if c["importe"] < 0 else 0)
        conceptos_out.append({
            **c,
            "tipo": tipo,
            "pct": round(c["importe"] / base * 100, 1) if base else 0.0,
        })

    top_creditos = [c for c in conceptos_out if c["tipo"] == "credito"][:5]
    top_debitos = [c for c in conceptos_out if c["tipo"] == "debito"][:5]

    # ---- Análisis rápido (descriptivo del mes, sin comparar) ----
    analisis: list[str] = []
    if parsed.get("periodo"):
        analisis.append(
            f"Liquidación {parsed['nro_liquidacion']} · período de venta dominante "
            f"{parsed['periodo']} · {parsed['total_rows']:,} movimientos.".replace(",", ".")
        )
    analisis.append(
        f"Facturación neta {_fmt_gs(total)} = créditos {_fmt_gs(creditos)} − "
        f"débitos {_fmt_gs(abs(debitos))}."
    )
    if ventas["activaciones"]:
        analisis.append(
            f"Volumen de ventas: {ventas['activaciones']:,} activaciones · "
            f"prima upfront {_fmt_gs(ventas['prima_upfront'])} · "
            f"ticket {_fmt_gs(ventas['ticket'])}.".replace(",", ".")
        )
    if top_creditos:
        c = top_creditos[0]
        analisis.append(f"Mayor crédito: {c['descripcion']} ({_fmt_gs(c['importe'])}).")
    if top_debitos:
        d = top_debitos[0]
        analisis.append(f"Mayor débito: {d['descripcion']} ({_fmt_gs(abs(d['importe']))}).")
    if susp["registros"]:
        cohorte = susp["por_mes_venta"][0] if susp["por_mes_venta"] else None
        extra = f" — mayor cohorte de venta: {cohorte['mes']} ({cohorte['pct']:.0f}%)" if cohorte else ""
        analisis.append(
            f"Suspensiones (PFI): {susp['registros']:,} líneas, {_fmt_gs(abs(susp['monto']))}{extra}.".replace(",", ".")
        )
    if doc["registros"]:
        cohorte = doc["por_mes_venta"][0] if doc["por_mes_venta"] else None
        extra = f" — cohorte de venta: {cohorte['mes']} ({cohorte['pct']:.0f}%)" if cohorte else ""
        analisis.append(
            f"Documentación faltante: {doc['registros']:,} legajos, {_fmt_gs(abs(doc['monto']))} "
            f"(promedio {_fmt_gs(abs(doc['promedio']))}){extra}.".replace(",", ".")
        )

    # Mix de planes + curva de planes más rentables (por ticket de comisión)
    plan_mix = parsed.get("plan_mix", [])
    planes_rentables = sorted(plan_mix, key=lambda p: -p.get("ticket", 0))
    if plan_mix:
        top_plan = plan_mix[0]
        rent = planes_rentables[0]
        analisis.append(
            f"Mix de planes: {len(plan_mix)} planes; el más vendido es {top_plan['plan']} "
            f"({top_plan['activaciones']} act.). El de mayor ticket es {rent['plan']} "
            f"({_fmt_gs(rent['ticket'])}/activación)."
        )

    kpis = {
        "nro_liquidacion": parsed["nro_liquidacion"],
        "periodo": parsed.get("periodo"),
        "total": total,
        "creditos": creditos,
        "debitos": debitos,
        "ventas_activaciones": ventas["activaciones"],
        "ticket": ventas["ticket"],
        "total_rows": parsed["total_rows"],
    }

    return {
        "kpis": kpis,
        "conceptos": conceptos_out,            # TODAS las descripciones
        "top_creditos": top_creditos,
        "top_debitos": top_debitos,
        "ventas": ventas,
        "suspensiones": susp,
        "doc_faltante": doc,
        "plan_mix": plan_mix,
        "planes_rentables": planes_rentables,
        "cohorte_calidad": parsed.get("cohorte_calidad", {}),
        "analisis_rapido": analisis,
    }
