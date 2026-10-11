"""Facturación (liquidaciones de comisiones de Claro, Pospago móvil y GPON) para Voi.

Información sensible: montos de comisiones. Solo la ven quienes tienen la utilidad «Facturación» (el superadmin y el
Sub gerente: es una utilidad restringida, ningún otro perfil la puede tener) y nunca en modo auditoría. El permiso se
vuelve a leer en cada llamada. Reutiliza las mismas consultas y simuladores del módulo (no hay una segunda verdad).
"""
from __future__ import annotations

import math
from typing import Any

from ...operativas.televentas_claro.facturacion.agent.agent import CRITERIOS
from ...operativas.televentas_claro.facturacion.agent.tools import (
    fact_calidad_fecha_impl, fact_comparar_impl, fact_listar_reportes_impl, fact_obtener_reporte_impl)
from ...operativas.televentas_claro.facturacion.analyzers.gpon import PARAMETROS_GPON_DEFAULT, simular_gpon
from ...operativas.televentas_claro.facturacion.analyzers.simulador import (
    PARAMETROS_DEFAULT, pct_recalculo_efectivo, simular_facturacion)
from .base import CONSULTAR, TC, Ctx, ErrorHerramienta, Herramienta, compactar, esquema, registrar

P_FACT = f"{TC}.facturacion"
MODOS_FACT = frozenset({"superadmin", "gestion"})
PANTALLA = "/televentas-claro/facturacion"
CONFIDENCIAL = ("Datos de comisiones (confidenciales): no los anotes en la memoria y no los repitas fuera de esta "
                "conversación. Decí «PFI», nunca «fraude».")


def _ref(valor: Any) -> str | None:
    v = str(valor or "").strip()
    return v[:40] or None


def _refs(valor: Any) -> list[str] | None:
    if not valor:
        return None
    if isinstance(valor, str):
        valor = [x for x in valor.replace(";", ",").split(",")]
    refs = [r for r in (_ref(x) for x in valor) if r]
    return refs[:24] or None


# ------------------------------------------------------------------ liquidaciones
async def _liquidaciones(ctx: Ctx, e: dict[str, Any]) -> Any:
    r = await fact_listar_reportes_impl()
    if r.get("sin_datos"):
        return {**r, "pantalla": PANTALLA}
    return {"liquidaciones": compactar(r["reportes"], max_lista=24), "total": r["total"], "pantalla": PANTALLA,
            "importante": CONFIDENCIAL}


def _conceptos(conceptos: list[dict[str, Any]], n: int = 20) -> list[dict[str, Any]]:
    orden = sorted(conceptos or [], key=lambda c: -abs(float(c.get("importe") or 0)))
    return [{k: c.get(k) for k in ("descripcion", "concepto", "importe", "registros", "tipo", "pct") if k in c}
            for c in orden[:n]]


async def _liquidacion(ctx: Ctx, e: dict[str, Any]) -> Any:
    r = await fact_obtener_reporte_impl(_ref(e.get("referencia")))
    if r.get("sin_datos"):
        raise ErrorHerramienta(r.get("mensaje") or "No encontré esa liquidación.")
    ventas, susp, doc = r.get("ventas") or {}, r.get("suspensiones") or {}, r.get("doc_faltante") or {}
    return {
        "resumen": r["resumen"], "kpis": r.get("kpis"),
        "conceptos_principales": _conceptos(r.get("conceptos") or []),
        "ventas": compactar(ventas, max_lista=31),
        "suspensiones_pfi": compactar(susp, max_lista=31),
        "documentacion_faltante": compactar(doc, max_lista=12),
        "mix_de_planes": compactar(r.get("plan_mix") or [], max_lista=10),
        "planes_por_ticket": compactar(r.get("planes_rentables") or [], max_lista=6),
        "analisis_rapido": r.get("analisis_rapido") or [],
        "pantalla": f"{PANTALLA}/reports/{r['resumen']['id']}", "importante": CONFIDENCIAL,
    }


async def _comparar(ctx: Ctx, e: dict[str, Any]) -> Any:
    refs = _refs(e.get("referencias"))
    if not refs:
        lista = await fact_listar_reportes_impl()
        refs = [x["periodo"] or x["id"] for x in (lista.get("reportes") or [])[:3]][::-1]
    if not refs or len(refs) < 2:
        raise ErrorHerramienta("Necesito al menos 2 liquidaciones cargadas para comparar.")
    r = await fact_comparar_impl(refs)
    if r.get("error"):
        raise ErrorHerramienta(r["error"])
    return {
        "columnas": [{k: c.get(k) for k in ("periodo", "nro_liquidacion", "title") if k in c} for c in r["columnas"]],
        "totales": r.get("totales"), "creditos": r.get("creditos"), "debitos": r.get("debitos"), "ventas": r.get("ventas"),
        "descomposicion_del_cambio": compactar(r.get("descomposicion"), max_lista=12),
        "delta_total": r.get("delta_total"), "drivers": compactar(r.get("drivers"), max_lista=12),
        "variaciones": compactar(r.get("variaciones"), max_lista=12), "hallazgos": r.get("hallazgos"),
        "conceptos": compactar(r.get("conceptos"), max_lista=15),
        "pantalla": f"{PANTALLA}/compare", "importante": CONFIDENCIAL,
    }


async def _calidad(ctx: Ctx, e: dict[str, Any]) -> Any:
    r = await fact_calidad_fecha_impl(_refs(e.get("referencias")))
    if r.get("sin_datos"):
        raise ErrorHerramienta(r.get("mensaje") or "Necesito al menos 2 liquidaciones.")
    return {"mayor_calidad": r.get("mayor_calidad"), "menor_calidad": r.get("menor_calidad"),
            "inmaduras": compactar(r.get("inmaduras"), max_lista=10), "corte_maduro": r.get("corte_maduro"),
            "nota": r.get("nota"), "pantalla": PANTALLA, "importante": CONFIDENCIAL}


# ------------------------------------------------------------------ criterios
def _escala(escala: list[dict[str, Any]]) -> str:
    return " · ".join(f"≥{e['desde_pct']}% {int(e['monto']):,} por línea".replace(",", ".")
                      for e in sorted(escala, key=lambda x: -float(x["desde_pct"])))


def criterios_negocio() -> dict[str, Any]:
    """Los criterios de liquidación de cada negocio, leídos de los parámetros de los simuladores (la misma fuente)."""
    p, g = PARAMETROS_DEFAULT, PARAMETROS_GPON_DEFAULT
    return {
        "pospago_movil": {
            "cuota_1": "Upfront: se cobra al activar la línea, según el plan.",
            "cuota_2": f"Diferida: en el mes {p['cuota2_mes']} si la línea sigue activa (al día 60 según el manual); con "
                       "legajo incompleto se cobra la mitad.",
            "planes_gs_sin_iva": [{k: x[k] for k in ("plan", "cuota1", "cuota2", "porta_plus", "abono", "mix_pct")}
                                  for x in p["planes"]],
            "portabilidad": f"Plus por línea portada (≈{p['porta_pct']:g}% de las activaciones); se devuelve en toda "
                            "caída dentro del chargeback.",
            "bono_productividad": f"Por línea en estado A según cumplimiento del objetivo: {_escala(p['escala_productividad'])}; "
                                  "debajo del 95% no se cobra.",
            "recalculo_productividad": f"Una vez, en el mes {p['recalculo_productividad_mes']} (día 152–184): las líneas "
                                       f"caídas devuelven el 100% de su bono (hoy ≈{pct_recalculo_efectivo(p):g}% de "
                                       "las líneas según la zafra).",
            "bono_efectividad": f"Por venta entregada según la efectividad de entregas: {_escala(p['escala_efectividad'])}.",
            "residual": f"{p['residual_pct']:g}% del abono acreditado, durante {p['residual_meses']} meses (solo móvil).",
            "legajos": f"Incompleto (≈{p['legajo_incompleto_pct']:g}%): cuota 2 a la mitad y descuento de media cuota 1. "
                       f"No presentado (≈{p['legajo_no_presentado_pct']:g}%): descuento de la cuota 1 completa. Reversible "
                       "si Control Documental valida el reclamo; al día 365 se devuelve lo descontado.",
            "chargeback": f"{p['chargeback_meses']} meses (180 días desde la activación): una caída dentro del período "
                          "devuelve la comisión (≈{:g}% de las caídas pierden la cuota 1).".format(p["pct_caidas_penalizables"]),
            "recupero": f"≈{p['recupero_pct']:g}% de lo descontado vuelve después (reconexiones, reversos).",
            "pfi": "Suspensiones y cancelaciones por PFI descuentan TODA la comisión de la línea (decí «PFI», nunca «fraude»).",
        },
        "gpon": {
            "planes_gs_sin_iva": [{k: x[k] for k in ("nombre", "cuota1", "cuota2", "penalidad_mora", "mix_pct")}
                                  for x in g["planes"]],
            "cuota_1": "Al activar, según el plan.",
            "cuota_2": f"Entre el día 59 y 91 (liquidación del mes {g['cuota2_mes']}); la cobra ≈{g['cuota2_pct_lineas']:g}% "
                       "de las líneas; con legajo incompleto, la mitad.",
            "bono_fijo": f"Por línea según cumplimiento del objetivo: {_escala(g['escala_bono'])} (≈{g['pct_bono_cobrado']:g}% "
                         "de las activaciones lo cobran).",
            "recalculo": f"Mes {g['recalculo_mes']} (día 150–180): las líneas caídas devuelven el 100% del bono "
                         f"(≈{g['pct_recalculo']:g}% de la cohorte).",
            "legajos": f"Mes 1: descuento del {g['legajo_pct_cuota1']:g}% de la cuota 1 (≈{g['legajo_pct']:g}% de las líneas).",
            "mora": f"Penalización por deuda tabulada por plan, revertida si el cliente paga; queda en ≈{g['mora_pct_lineas']:g}% "
                    "de las líneas a los 6 meses.",
            "chargeback": f"{g['chargeback_meses']} meses (180 días exactos); después no hay más débitos.",
            "no_aplica": "Sin residual, sin plus de portabilidad y sin bono de efectividad.",
        },
    }


async def _criterios(ctx: Ctx, e: dict[str, Any]) -> Any:
    concepto = str(e.get("concepto") or "").strip().lower()[:80]
    negocio = str(e.get("negocio") or "").strip().lower()
    base = criterios_negocio()
    if negocio in ("pospago", "movil", "móvil", "pospago_movil"):
        base = {"pospago_movil": base["pospago_movil"]}
    elif negocio == "gpon":
        base = {"gpon": base["gpon"]}
    conceptos = CRITERIOS
    if concepto:
        conceptos = {k: v for k, v in CRITERIOS.items() if concepto in k.lower() or concepto in v.lower()} or CRITERIOS
    return {"criterios_por_negocio": base, "conceptos_de_la_liquidacion": conceptos,
            "fuente": "Manual de Esquemas y Conceptos TLMK Fijo PGY y parámetros calibrados del simulador de Facturación.",
            "pantalla": f"{PANTALLA}/criterios", "importante": CONFIDENCIAL}


# ------------------------------------------------------------------ simulador
_LIMITES = {"ajuste_comisiones_pct": (-90.0, 200.0), "ventas": (0.0, 100000.0), "objetivo_co": (1.0, 100000.0),
            "objetivo": (1.0, 100000.0)}


def _numero(nombre: str, v: Any, defecto: Any) -> Any:
    if isinstance(defecto, bool):
        if isinstance(v, bool):
            return v
        raise ErrorHerramienta(f"«{nombre}» va como verdadero o falso")
    try:
        n = float(v)
    except (TypeError, ValueError) as exc:
        raise ErrorHerramienta(f"«{nombre}» tiene que ser un número") from exc
    if not math.isfinite(n):
        raise ErrorHerramienta(f"«{nombre}» tiene que ser un número")
    minimo, maximo = _LIMITES.get(nombre, (0.0, 100.0 if nombre.endswith("_pct") else 1e10))
    if not minimo <= n <= maximo:
        raise ErrorHerramienta(f"«{nombre}» fuera de rango ({minimo:g} a {maximo:g})")
    return int(n) if isinstance(defecto, int) and n.is_integer() else n


def validar_cambios(cambios: Any, defectos: dict[str, Any]) -> dict[str, Any]:
    """Solo los parámetros numéricos o de sí/no que existen en el simulador (y los de costos)."""
    if not cambios:
        return {}
    if not isinstance(cambios, dict):
        raise ErrorHerramienta("«cambios» va como objeto {parámetro: valor}")
    salida: dict[str, Any] = {}
    for k, v in list(cambios.items())[:30]:
        if k == "costos" and isinstance(v, dict):
            salida["costos"] = {}
            for ck, cv in list(v.items())[:30]:
                if ck not in defectos["costos"] or isinstance(defectos["costos"][ck], (list, dict)):
                    raise ErrorHerramienta(f"Parámetro de costos desconocido: «{ck}»")
                salida["costos"][ck] = _numero(ck, cv, defectos["costos"][ck])
            continue
        if k not in defectos or isinstance(defectos[k], (list, dict, str)):
            raise ErrorHerramienta(f"Parámetro desconocido o no editable desde Voi: «{k}»")
        salida[k] = _numero(k, v, defectos[k])
    return salida


def _resumen_pospago(r: dict[str, Any]) -> dict[str, Any]:
    d = r["derivados"]
    return {
        "negocio": "Pospago móvil",
        "derivados": {k: d.get(k) for k in ("activaciones", "cumplimiento_pct", "monto_bono_productividad",
                                            "monto_bono_efectividad", "cuota1_ponderada", "cuota2_ponderada",
                                            "porta_plus_ponderado", "residual_por_linea", "clawback_por_linea",
                                            "pct_recalculo_efectivo")},
        "facturacion_mes0": r["mes0"], "bruto_mes0": r["bruto_mes0"], "neto_6": r["neto_6"], "neto_12": r["neto_12"],
        "pct_retenido_6": r["pct_retenido_6"], "pct_retenido_12": r["pct_retenido_12"],
        "bonos": {k: r["bonos"].get(k) for k in ("mes0", "peso_mes0_pct", "devueltos_6", "netos_6",
                                                  "distancia_productividad")},
        "costos": {k: r["costos"].get(k) for k in ("total", "costo_por_venta", "facturacion_por_venta", "neto_6_por_venta",
                                                    "headcount")},
        "margen": r["margen"], "cierre": r["cierre"], "conclusion": r["conclusion"],
        "recomendaciones": [{k: x.get(k) for k in ("severidad", "titulo", "detalle")} for x in r["recomendaciones"][:5]],
        "meses": [{k: m.get(k) for k in ("mes", "neto_mes", "acumulado", "residual", "cuota2", "clawbacks", "lineas_activas")
                   if k in m} for m in r["meses"][:13]],
    }


def _resumen_gpon(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "negocio": "GPON (fibra + TV)", "derivados": r["derivados"], "facturacion_mes0": r["mes0"],
        "bruto_mes0": r["bruto_mes0"], "neto_6": r["neto_6"], "neto_12": r["neto_12"],
        "pct_retenido_6": r["pct_retenido_6"], "pct_retenido_12": r["pct_retenido_12"], "por_linea": r.get("por_linea"),
        "costos": {k: r["costos"].get(k) for k in ("total", "costo_por_venta", "facturacion_por_venta", "neto_6_por_venta",
                                                    "headcount")},
        "margen": r["margen"], "cierre": r["cierre"],
        "meses": [{k: m.get(k) for k in ("mes", "neto_mes", "acumulado", "cuota2", "mora", "lineas_en_mora") if k in m}
                  for m in r["meses"][:13]],
    }


async def _simular(ctx: Ctx, e: dict[str, Any]) -> Any:
    negocio = str(e.get("negocio") or "pospago").strip().lower()
    if negocio in ("pospago", "movil", "móvil"):
        cambios = validar_cambios(e.get("cambios"), PARAMETROS_DEFAULT)
        r, pantalla = _resumen_pospago(simular_facturacion(cambios)), f"{PANTALLA}/simulador"
    elif negocio == "gpon":
        cambios = validar_cambios(e.get("cambios"), PARAMETROS_GPON_DEFAULT)
        r, pantalla = _resumen_gpon(simular_gpon(cambios)), f"{PANTALLA}/gpon"
    else:
        raise ErrorHerramienta("negocio: «pospago» o «gpon»")
    return {**compactar(r, max_lista=13), "cambios_aplicados": cambios or "ninguno (parámetros calibrados con las "
                                                                          "liquidaciones reales)",
            "pantalla": pantalla, "importante": CONFIDENCIAL}


# ------------------------------------------------------------------ registro
def _h(**kw: Any) -> Herramienta:
    return registrar(Herramienta(nivel=CONSULTAR, permisos=(P_FACT,), modos=MODOS_FACT, **kw))


_REFS = {"type": "array", "items": {"type": "string"}, "maxItems": 24,
         "description": "Períodos AAAA-MM, números de liquidación o ids (2 o más). Sin esto: las últimas tres."}

_h(nombre="facturacion_liquidaciones", etiqueta="Consultando las liquidaciones",
   descripcion="Lista las liquidaciones de comisiones de Claro cargadas (período, número, total, créditos, débitos, "
               "ventas). Usala para saber qué meses hay antes de analizar o comparar. Confidencial.",
   esquema=esquema(), fn=_liquidaciones)
_h(nombre="facturacion_liquidacion", etiqueta="Analizando la liquidación",
   descripcion="Detalle de una liquidación: KPIs, conceptos principales (créditos y débitos), ventas por día, "
               "suspensiones por PFI y documentación faltante por cohorte de venta, mix de planes. `referencia`: "
               "período AAAA-MM, número de liquidación o «ultimo». Explicá POR QUÉ cambia, no solo qué: drivers, "
               "cohortes (las penalidades maduran ~2 meses) y acciones con montos recuperables.",
   esquema=esquema({"referencia": {"type": "string", "description": "AAAA-MM, número de liquidación o «ultimo»."}}),
   fn=_liquidacion)
_h(nombre="facturacion_comparar", etiqueta="Comparando liquidaciones",
   descripcion="Compara 2 o más liquidaciones: matriz por concepto, drivers, variaciones y la DESCOMPOSICIÓN del "
               "cambio del último mes contra el anterior (cuánto aportó cada concepto). Es lo más importante para "
               "explicar una suba o una baja. Para tendencias usá al menos 3 meses.",
   esquema=esquema({"referencias": _REFS}), fn=_comparar)
_h(nombre="facturacion_calidad_por_fecha", etiqueta="Cruzando la calidad de venta por fecha",
   descripcion="Cruza activaciones contra penalidades por FECHA de venta entre liquidaciones: las fechas de ventas de "
               "mayor y menor calidad. Solo rankea cohortes maduras (~2 meses): aclaralo y no afirmes que un mes reciente "
               "es el mejor.",
   esquema=esquema({"referencias": _REFS}), fn=_calidad)
_h(nombre="facturacion_criterios", etiqueta="Consultando los criterios de liquidación",
   descripcion="Los criterios de liquidación de Claro para Pospago móvil y GPON: cuotas 1 y 2, plus de portabilidad, "
               "escalas de bonos de productividad y efectividad, recálculo, residual, legajos, chargeback de 180 días, "
               "PFI, mora y recupero, más el significado de cada concepto de la liquidación. Usala para explicar una "
               "regla con exactitud (no de memoria).",
   esquema=esquema({"negocio": {"type": "string", "enum": ["pospago", "gpon"], "description": "Opcional: un solo negocio."},
                    "concepto": {"type": "string", "description": "Opcional: filtra los conceptos (p. ej. «diferido»)."}}),
   fn=_criterios)
_h(nombre="facturacion_simular", etiqueta="Simulando la facturación",
   descripcion="Corre el simulador de facturación (el mismo de la plataforma, calibrado con liquidaciones reales) y "
               "devuelve la facturación del mes 0, lo que queda a 6 y 12 meses, bonos, costos de la estructura, margen, "
               "conclusión y recomendaciones. Sin `cambios` usa los parámetros calibrados. Para «¿qué pasa si…?» corré "
               "dos veces (base y escenario) y compará.\n"
               "Pospago, cambios habituales: ventas, objetivo_co, efectividad_pct, porta_pct, legajo_incompleto_pct, "
               "legajo_no_presentado_pct, recupero_pct, bonos_activos (true/false), bono_adicional (Gs), "
               "ajuste_comisiones_pct (−90 a 200), costos.ventas_por_vendedor.\n"
               "GPON: ventas, objetivo, legajo_pct, mora_pct_lineas, pct_recalculo, pct_bono_cobrado, bonos_activos, "
               "bono_adicional, ajuste_comisiones_pct, costos.ventas_por_vendedor.",
   esquema=esquema({"negocio": {"type": "string", "enum": ["pospago", "gpon"]},
                    "cambios": {"type": "object", "description": "{parámetro: valor}; «costos» es un objeto aparte."}},
                   ["negocio"]),
   fn=_simular)
