"""El simulador anual y convergente de Facturación, manejado por Voi.

Voi corre el mismo motor que la pantalla (`simular_convergente`: pospago + GPON por la misma estructura), con los
mismos valores iniciales y presets que los botones del simulador (IDEAL, Bono único, Optimizar), compara escenarios,
guarda simulaciones en el registro del trabajo, las anota y las abre en la pantalla (`?abrir=<id>`).

Confidencial: solo quien tiene la utilidad Facturación (superadmin y Sub gerente), nunca en modo auditoría.
"""
from __future__ import annotations

import copy
import math
from datetime import date
from typing import Any

from sqlalchemy import select

from ...operativas.televentas_claro.facturacion import api as fact_api
from ...operativas.televentas_claro.facturacion.analyzers.convergente import GPON_POR_ASESOR_IDEAL, simular_convergente
from ...operativas.televentas_claro.facturacion.analyzers.gpon import PARAMETROS_GPON_DEFAULT
from ...operativas.televentas_claro.facturacion.analyzers.presets import (
    AJUSTE_OPTIMIZAR_PCT, GROSS_BANDA, PRESET_IDEAL_MOVIL, PRESET_INICIAL_MOVIL, ZAFRA_IDEAL, ZAFRA_TOLERANCIA,
    aplicar_bono_unico, aplicar_preset, coincide_preset)
from ...operativas.televentas_claro.facturacion.analyzers.simulador import PARAMETROS_DEFAULT
from ...operativas.televentas_claro.facturacion.models.simulacion import FacturacionSimulacion
from ...operativas.televentas_claro.facturacion.schemas import SimulacionCreate
from .base import CONSULTAR, PROPIO, Ctx, ErrorHerramienta, Herramienta, compactar, esquema, llamar, registrar, texto
from .facturacion import CONFIDENCIAL, MODOS_FACT, P_FACT, PANTALLA, _numero, validar_cambios

PANTALLA_ANUAL = f"{PANTALLA}/simulador-anual"
HORIZONTES = (12, 18)
MESES_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre",
            "Noviembre", "Diciembre"]
PRESETS = ("inicial", "ideal", "real")
TIPOS_NOTA = ("supuesto", "observacion", "decision", "pendiente", "riesgo")

# Variaciones que admite un mes afectado (las mismas del editor ✎ de la pantalla).
AFECTABLES_MOVIL = frozenset({"porta_pct", "efectividad_pct", "pct_bono_efectividad_cobrado", "objetivo_co", "pct_estado_a",
                              "ajuste_comisiones_pct", "bonos_activos", "legajo_incompleto_pct", "legajo_no_presentado_pct",
                              "pct_caidas_penalizables", "recupero_pct", "pct_bajas_gross", "pct_recalculo_productividad",
                              "migracion_negocio_pct"})
AFECTABLES_COSTOS_MOVIL = frozenset({"comision_por_venta", "plus_por_venta", "logistica_interior_pct", "operativo_por_venta"})
AFECTABLES_GPON = frozenset({"objetivo", "pct_bono_cobrado", "ajuste_comisiones_pct", "bonos_activos", "cuota2_pct_lineas",
                             "cuota2_pct_completa", "legajo_no_presentado_pct", "legajo_pct", "mora_pct_lineas",
                             "mora_penalidad_pct", "pct_recalculo"})
AFECTABLES_COSTOS_GPON = frozenset({"comision_por_venta", "plus_por_venta", "operativo_por_venta"})


# ------------------------------------------------------------------ entrada normalizada
def _horizonte(v: Any) -> int:
    try:
        h = int(v or 12)
    except (TypeError, ValueError) as exc:
        raise ErrorHerramienta("«horizonte» es 12 o 18 (meses)") from exc
    if h not in HORIZONTES:
        raise ErrorHerramienta("«horizonte» es 12 o 18 (meses)")
    return h


def _lista_numeros(nombre: str, v: Any, h: int, minimo: float = 0.0, maximo: float = 1e10) -> list[float]:
    if v is None:
        return []
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        v = [v]
    if not isinstance(v, list):
        raise ErrorHerramienta(f"«{nombre}» va como lista de números (uno por mes) o un número para todos los meses")
    out: list[float] = []
    for x in v[:h]:
        try:
            n = float(x)
        except (TypeError, ValueError) as exc:
            raise ErrorHerramienta(f"«{nombre}» tiene un valor que no es número") from exc
        if not math.isfinite(n) or not minimo <= n <= maximo:
            raise ErrorHerramienta(f"«{nombre}»: valores de {minimo:g} a {maximo:g}")
        out.append(n)
    return out


def _nombres_meses(e: dict[str, Any], h: int) -> list[str]:
    nombres = e.get("nombres_meses")
    if isinstance(nombres, list) and nombres:
        return [str(x or "")[:40] for x in nombres[:h]]
    primer = str(e.get("primer_mes") or "").strip()
    if not primer:
        return []
    try:
        anio, mes = int(primer[:4]), int(primer[5:7])
        if not 1 <= mes <= 12:
            raise ValueError
    except ValueError as exc:
        raise ErrorHerramienta("«primer_mes» va como AAAA-MM (por ejemplo 2027-01)") from exc
    out = []
    for i in range(h):
        m = (mes - 1 + i) % 12
        out.append(f"{MESES_ES[m]} {anio + (mes - 1 + i) // 12}")
    return out


def _afectados(v: Any, h: int) -> dict[str, dict[str, Any]]:
    """{"7": {"porta_pct": 85, "comision_por_venta": 110000, "gpon": {"objetivo": 300}}} → lo que espera el motor
    (los costos anidados en «costos», GPON aparte). Solo meses 2..h."""
    if not v:
        return {}
    if not isinstance(v, dict):
        raise ErrorHerramienta("«meses_afectados» va como objeto {\"mes\": {parámetro: valor}} (mes 2 al último)")
    out: dict[str, dict[str, Any]] = {}
    for k, ov in list(v.items())[:h]:
        try:
            mes = int(k)
        except (TypeError, ValueError) as exc:
            raise ErrorHerramienta(f"Mes afectado inválido «{k}»: usá el número de mes (2 a {h})") from exc
        if not 2 <= mes <= h or not isinstance(ov, dict):
            raise ErrorHerramienta(f"Mes afectado «{k}»: va del 2 al {h} y lleva un objeto con las variaciones")
        limpio: dict[str, Any] = {}
        costos: dict[str, Any] = dict(ov.get("costos") or {})
        gpon_in = dict(ov.get("gpon") or {})
        for ck, cv in ov.items():
            if ck in ("costos", "gpon"):
                continue
            if ck in AFECTABLES_MOVIL:
                limpio[ck] = None if (ck == "pct_recalculo_productividad" and cv is None) else _numero(ck, cv, PARAMETROS_DEFAULT[ck] if ck != "pct_recalculo_productividad" else 0.0)
            elif ck in AFECTABLES_COSTOS_MOVIL:
                costos[ck] = cv
            else:
                raise ErrorHerramienta(f"«{ck}» no se puede variar por mes. Pospago: {', '.join(sorted(AFECTABLES_MOVIL | AFECTABLES_COSTOS_MOVIL))}; "
                                       f"GPON (dentro de «gpon»): {', '.join(sorted(AFECTABLES_GPON | AFECTABLES_COSTOS_GPON))}")
        if costos:
            limpio["costos"] = {}
            for ck, cv in costos.items():
                if ck not in AFECTABLES_COSTOS_MOVIL:
                    raise ErrorHerramienta(f"«costos.{ck}» no se puede variar por mes")
                limpio["costos"][ck] = _numero(ck, cv, PARAMETROS_DEFAULT["costos"][ck])
        if gpon_in:
            g: dict[str, Any] = {}
            gc: dict[str, Any] = dict(gpon_in.get("costos") or {})
            for ck, cv in gpon_in.items():
                if ck == "costos":
                    continue
                if ck in AFECTABLES_GPON:
                    g[ck] = _numero(ck, cv, PARAMETROS_GPON_DEFAULT[ck])
                elif ck in AFECTABLES_COSTOS_GPON:
                    gc[ck] = cv
                else:
                    raise ErrorHerramienta(f"«gpon.{ck}» no se puede variar por mes")
            if gc:
                g["costos"] = {ck: _numero(ck, cv, PARAMETROS_GPON_DEFAULT["costos"][ck]) for ck, cv in gc.items()
                               if ck in AFECTABLES_COSTOS_GPON}
            if g:
                limpio["gpon"] = g
        if limpio:
            out[str(mes)] = limpio
    return out


def _separar_afectados(afectados: dict[str, dict[str, Any]]) -> tuple[dict, dict]:
    movil, gpon = {}, {}
    for m, ov in afectados.items():
        resto = {k: v for k, v in ov.items() if k != "gpon"}
        if resto:
            movil[m] = resto
        if ov.get("gpon"):
            gpon[m] = ov["gpon"]
    return movil, gpon


def entrada_anual(e: dict[str, Any]) -> dict[str, Any]:
    """Normaliza lo que pide Voi a lo que corre el motor; los valores iniciales son los de la pantalla."""
    h = _horizonte(e.get("horizonte"))
    preset = str(e.get("preset") or "inicial").strip().lower()
    if preset not in PRESETS:
        raise ErrorHerramienta("«preset»: inicial (valores iniciales de la dirección, zafra real), ideal (más la zafra ideal) o real (solo calibrados)")
    base = copy.deepcopy(PARAMETROS_DEFAULT)
    if preset == "inicial":
        base = aplicar_preset(base, PRESET_INICIAL_MOVIL)
    elif preset == "ideal":
        base = aplicar_preset(base, PRESET_IDEAL_MOVIL)
    cambios = validar_cambios(e.get("cambios"), PARAMETROS_DEFAULT)
    params = aplicar_preset(base, cambios)
    if bool(e.get("bono_unico")):
        params = aplicar_bono_unico(params)
    if bool(e.get("optimizar")) and "ajuste_comisiones_pct" not in cambios:
        params["ajuste_comisiones_pct"] = AJUSTE_OPTIMIZAR_PCT

    ventas = _lista_numeros("ventas_por_mes", e.get("ventas_por_mes"), h, 0, 100000)
    if not ventas and e.get("ventas") is not None:
        ventas = [_numero("ventas", e.get("ventas"), 0.0)]
    if not ventas:
        ventas = [float(params["ventas"])]
    while len(ventas) < h:
        ventas.append(ventas[-1])
    params["ventas"] = ventas[0]

    bonos_ad = _lista_numeros("bonos_adicionales_por_mes", e.get("bonos_adicionales_por_mes"), h, 0, 1e11)
    while bonos_ad and len(bonos_ad) < h:
        bonos_ad.append(0.0)
    nombres = _nombres_meses(e, h)
    afectados = _afectados(e.get("meses_afectados"), h)

    g = e.get("gpon") if isinstance(e.get("gpon"), dict) else {}
    activo = bool(g.get("activo", True)) if g else bool(e.get("gpon", True)) if isinstance(e.get("gpon"), bool) else True
    por_asesor = _lista_numeros("gpon.por_asesor", g.get("por_asesor", g.get("por_asesor_por_mes")), h, 0, 20) if g else []
    if not por_asesor:
        por_asesor = [GPON_POR_ASESOR_IDEAL]
    while len(por_asesor) < h:
        por_asesor.append(por_asesor[-1])
    cambios_gpon = validar_cambios(g.get("cambios"), PARAMETROS_GPON_DEFAULT) if g else {}
    pg = aplicar_preset(copy.deepcopy(PARAMETROS_GPON_DEFAULT), cambios_gpon)
    objetivo_auto = True
    if g and g.get("objetivo") is not None:
        pg["objetivo"] = _numero("objetivo", g.get("objetivo"), PARAMETROS_GPON_DEFAULT["objetivo"])
        objetivo_auto = False
    bonos_ad_gpon = _lista_numeros("gpon.bonos_adicionales_por_mes", g.get("bonos_adicionales_por_mes"), h, 0, 1e11) if g else []
    af_movil, af_gpon = _separar_afectados(afectados)

    return {
        "horizonte": h, "preset": preset, "bono_unico": bool(params.get("bono_unico")),
        "optimizar": bool(e.get("optimizar")), "parametros": params, "cambios": cambios,
        "ventas_por_mes": ventas, "bonos_adicionales_por_mes": bonos_ad, "nombres_meses": nombres,
        "meses_afectados": afectados, "meses_afectados_movil": af_movil,
        "gpon": {"activo": activo, "por_asesor_por_mes": por_asesor, "parametros": pg, "cambios": cambios_gpon,
                 "objetivo_auto": objetivo_auto, "bonos_adicionales_por_mes": bonos_ad_gpon, "meses_afectados": af_gpon},
    }


def correr(entrada: dict[str, Any]) -> dict[str, Any]:
    g = entrada["gpon"]
    gpon = {"activo": g["activo"], "parametros": g["parametros"], "por_asesor_por_mes": g["por_asesor_por_mes"],
            "bonos_adicionales_por_mes": g["bonos_adicionales_por_mes"], "meses_afectados": g["meses_afectados"],
            "objetivo_auto": g["objetivo_auto"]}
    try:
        return simular_convergente(entrada["parametros"], entrada["ventas_por_mes"], entrada["horizonte"],
                                   entrada["meses_afectados_movil"], entrada["bonos_adicionales_por_mes"],
                                   entrada["nombres_meses"], gpon)
    except (TypeError, ValueError, KeyError) as exc:
        raise ErrorHerramienta(f"Parámetros inválidos: {exc}") from exc


# ------------------------------------------------------------------ lectura del resultado
def cambios_respecto_calibrado(params: dict[str, Any], defaults: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Qué parámetros difieren de los calibrados con las liquidaciones reales (para que Voi lo diga y la ficha lo marque)."""
    d = defaults or PARAMETROS_DEFAULT
    out: list[dict[str, Any]] = []
    for k, v in (params or {}).items():
        if k in ("convergente", "negocio", "_sin_breakeven") or k not in d:
            continue
        if k == "costos":
            for ck, cv in (v or {}).items():
                if ck in d["costos"] and _distinto(cv, d["costos"][ck]):
                    out.append({"parametro": f"costos.{ck}", "valor": cv, "calibrado": d["costos"][ck]})
        elif _distinto(v, d[k]):
            out.append({"parametro": k, "valor": v, "calibrado": d[k]})
    return out


def _distinto(a: Any, b: Any) -> bool:
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return True
        return any(_distinto(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return any(_distinto(a.get(k), b.get(k)) for k in set(a) | set(b))
    if isinstance(a, bool) or isinstance(b, bool) or a is None or b is None:
        return a != b
    try:
        return abs(float(a) - float(b)) > 1e-9
    except (TypeError, ValueError):
        return a != b


def _lectura_zafra(zafra: list[float]) -> dict[str, Any]:
    fuera = []
    for i, z in enumerate(zafra[:len(ZAFRA_IDEAL)]):
        ideal = ZAFRA_IDEAL[i]
        if z < ideal - ZAFRA_TOLERANCIA:
            fuera.append({"mes": i, "zafra": z, "ideal": ideal, "diferencia": round(z - ideal, 1)})
    return {"es_la_ideal": [float(x) for x in zafra] == [float(x) for x in ZAFRA_IDEAL],
            "m2_pfi": zafra[2] if len(zafra) > 2 else None, "m6": zafra[6] if len(zafra) > 6 else None,
            "m12": zafra[12] if len(zafra) > 12 else None,
            "meses_debajo_de_la_banda_ideal": fuera, "tolerancia_puntos": ZAFRA_TOLERANCIA}


def _escenario(entrada: dict[str, Any], r: dict[str, Any]) -> dict[str, Any]:
    p = entrada["parametros"]
    return {
        "preset": entrada["preset"],
        "coincide_con_ideal": coincide_preset(p, PRESET_IDEAL_MOVIL),
        "bono_unico": bool(p.get("bono_unico")),
        "sin_descuento_bono_productividad": p.get("devolver_bono_productividad") is False,
        "sin_descuento_bono_efectividad": p.get("devolver_bono_efectividad") is False,
        "ajuste_comisiones_pct": float(p.get("ajuste_comisiones_pct") or 0),
        "bonos_activos": p.get("bonos_activos") is not False,
        "gpon_incluido": bool(r.get("gpon")),
        "cambios_respecto_calibrado": cambios_respecto_calibrado(p),
    }


def resumen(entrada: dict[str, Any], r: dict[str, Any], con_meses: bool = True) -> dict[str, Any]:
    a = r["anual"]
    cola = a.get("cola_post_12") or {}
    nombres = r.get("nombres_meses") or []
    meses = [{
        "mes": f["mes"], "nombre": nombres[i] if i < len(nombres) else f.get("nombre"), "ventas": f.get("ventas"),
        "ventas_gpon": f.get("ventas_gpon"), "facturacion_bruta": f["facturacion_bruta"], "ajustes": f["ajustes"],
        "ingreso_neto": f["ingreso_neto"], "costos": f["costo_total"], "resultado": f["resultado"],
        "margen_pct": f["margen_pct"], "acumulado": f["acumulado"], "ola_devoluciones": f.get("ola_devoluciones"),
        "ventas_equilibrio": f.get("ventas_equilibrio"), "en_riesgo": f.get("en_riesgo"),
        "cumplimiento_pct": f.get("cumplimiento_pct"), "bono_por_linea": f.get("monto_bono_productividad"),
        "pct_gross": f.get("pct_gross"), "afectado": f.get("afectado") or f.get("gpon_afectado") or False,
    } for i, f in enumerate(r["meses"])]
    bajo, alto = GROSS_BANDA
    out = {
        "negocio": "Convergente (pospago + GPON por la misma estructura)" if r.get("gpon") else "Pospago móvil (GPON excluido)",
        "horizonte": r["horizonte"],
        "estructura_mes_1": {**r["headcount"], "costo_fijo_mes": a.get("costos_fijos_mes"),
                             "ventas_por_vendedor": entrada["parametros"]["costos"].get("ventas_por_vendedor")},
        "ventas_por_mes": r["ventas_por_mes"], "ventas_gpon_por_mes": r.get("ventas_gpon_por_mes"),
        "gpon_por_asesor_por_mes": r.get("gpon_por_asesor_por_mes"),
        "anual": {
            "facturacion_bruta": a["facturacion_bruta"], "ajustes": a["ajustes"], "ingreso_neto": a["ingreso_neto"],
            "costos": a["costos"], "resultado": a["resultado"], "margen_pct": a["margen_pct"],
            "bonos": a.get("bonos"), "devolucion_bonos": a.get("devolucion_bonos"),
            "devoluciones_del_periodo": a.get("devoluciones_periodo"), "cobros_del_periodo": a.get("cobros_periodo"),
            "cola_despues_del_horizonte": {"por_cobrar": cola.get("cobros"), "por_devolver": cola.get("devoluciones"),
                                           "total": cola.get("total"), "ultimo_mes_caidas": cola.get("ultimo_mes_caidas")},
            "resultado_con_cola": a.get("resultado_con_cola"), "veredicto": a.get("veredicto"),
            "meses_negativos": a.get("meses_negativos"), "mejor_mes": a.get("mejor_mes"), "peor_mes": a.get("peor_mes"),
            "regimen_ultimo_mes": a.get("regimen"), "ola_devoluciones_maxima": a.get("ola_maxima"), "ola_maxima_mes": a.get("ola_maxima_mes"),
            "meses_en_riesgo": a.get("meses_en_riesgo"), "ventas_equilibrio_max": a.get("ventas_equilibrio_max"),
            "gross": {"pct_gross_promedio": a.get("pct_gross"), "pct_gross_max": a.get("pct_gross_max"),
                      "pct_gross_max_mes": a.get("pct_gross_max_mes"), "meses_sobre_la_banda": a.get("meses_gross_sobre_banda"),
                      "banda_referencia": f"{bajo:g}–{alto:g} % (otros calls 12–27 %)"},
            "meses_sin_bono_productividad": a.get("meses_sin_bono_productividad"),
        },
        "por_negocio": {
            "pospago": {"ingreso_neto": a.get("ingreso_neto_movil", a["ingreso_neto"]), "costos": a.get("costos_movil", a["costos"]),
                        "resultado": a.get("resultado_movil", a["resultado"]), "margen_pct": a.get("margen_pct_movil", a["margen_pct"]),
                        "resultado_con_cola": a.get("resultado_con_cola_movil", a["resultado_con_cola"])},
            "gpon": {"activaciones": a.get("ventas_gpon"), "por_asesor": a.get("gpon_por_asesor"), "ingreso_neto": a.get("ingreso_neto_gpon"),
                     "costos_variables": a.get("costos_gpon"), "resultado": a.get("resultado_gpon"), "margen_pct": a.get("margen_pct_gpon"),
                     "mora": a.get("gpon_mora"), "cuota2": a.get("gpon_cuota2"), "legajos": a.get("gpon_legajos"),
                     "recalculo": a.get("gpon_recalculo"), "aporte_al_ingreso_pct": a.get("aporte_gpon_ingreso_pct"),
                     "meses_que_salva": a.get("meses_en_riesgo_sin_gpon"), "incluido": True} if r.get("gpon") else {"incluido": False},
        },
        "zafra": _lectura_zafra(list(entrada["parametros"].get("zafra_pct") or [])),
        "escenario": _escenario(entrada, r),
        "conclusion": r["conclusion"],
    }
    if con_meses:
        out["meses"] = meses
    return out


_CLAVES_COMPARACION = (("ingreso_neto", "anual"), ("costos", "anual"), ("resultado", "anual"), ("margen_pct", "anual"),
                       ("resultado_con_cola", "anual"), ("meses_negativos", "anual"), ("bonos", "anual"),
                       ("devolucion_bonos", "anual"))


def comparar(resumenes: list[tuple[str, dict[str, Any]]]) -> dict[str, Any]:
    """Los mismos indicadores lado a lado y la diferencia de cada escenario contra el primero (la base)."""
    base = resumenes[0][1]
    filas = []
    for clave, grupo in _CLAVES_COMPARACION:
        fila = {"indicador": clave, resumenes[0][0]: base[grupo].get(clave)}
        for nombre, res in resumenes[1:]:
            v, b = res[grupo].get(clave), base[grupo].get(clave)
            fila[nombre] = v
            if isinstance(v, (int, float)) and isinstance(b, (int, float)):
                fila[f"{nombre} (diferencia)"] = round(v - b, 1 if clave.endswith("_pct") else 0)
        filas.append(fila)
    return {"base": resumenes[0][0], "indicadores": filas,
            "veredictos": {n: res["anual"]["veredicto"] for n, res in resumenes},
            "estructura": {n: res["estructura_mes_1"] for n, res in resumenes}}


# ------------------------------------------------------------------ herramientas: simular y comparar
def _descripcion_entrada() -> dict[str, Any]:
    return {
        "horizonte": {"type": "integer", "enum": [12, 18], "description": "Meses del balance (12 por defecto)."},
        "preset": {"type": "string", "enum": list(PRESETS),
                   "description": "inicial = los valores iniciales de la dirección con la zafra real (lo que abre la pantalla; por "
                                  "defecto); ideal = además la zafra ideal (botón IDEAL); real = solo los calibrados con las liquidaciones."},
        "ventas_por_mes": {"type": "array", "items": {"type": "number"}, "maxItems": 18,
                           "description": "Ventas de pospago por mes (mes 1 dimensiona la estructura). Si faltan meses se repite el último."},
        "ventas": {"type": "number", "description": "Atajo: las mismas ventas todos los meses."},
        "primer_mes": {"type": "string", "description": "AAAA-MM del mes 1: nombra los meses (Enero 2027, …)."},
        "nombres_meses": {"type": "array", "items": {"type": "string"}, "maxItems": 18},
        "cambios": {"type": "object", "description": "Parámetros de pospago a cambiar {nombre: valor}: ventas/objetivo (objetivo_co), "
                    "efectividad_pct, pct_bono_efectividad_cobrado, pct_estado_a, porta_pct, bonos_activos, devolver_bono_productividad, "
                    "devolver_bono_efectividad, bono_adicional, ajuste_comisiones_pct, legajo_incompleto_pct, legajo_no_presentado_pct, "
                    "residual_pct, pct_abono_acreditado, residual_segun_zafra, zafra_pct (13 valores M0..M12), chargeback_meses, "
                    "pct_caidas_penalizables, migracion_negocio_pct, recupero_pct, pct_bajas_gross, pct_recalculo_productividad (null = "
                    "según zafra), escala_productividad / escala_efectividad ([{desde_pct, monto}]), planes ([{plan, mix_pct, cuota1, "
                    "cuota2, porta_plus, abono}]) y costos {ventas_por_vendedor, supervisor_cada_vendedores, backoffice_cada_ventas, "
                    "coordinadores, controllers, salario_hora, horas_dia, dias_mes, comision_por_venta, plus_por_venta, ips_pct, "
                    "logistica_central, logistica_interior, logistica_interior_pct, logistica_premios, operativo_por_venta, …}."},
        "bono_unico": {"type": "boolean", "description": "Propuesta 2027: bono único (≥110 % 55.000 · ≥100 % 50.000 · ≥95 % 35.000 · "
                       "≥90 % 25.000), sin bono efectividad y sin descuentos en las caídas."},
        "optimizar": {"type": "boolean", "description": "Botón Optimizar: +40 % sobre cuota 1, cuota 2 y plus de portabilidad."},
        "bonos_adicionales_por_mes": {"type": "array", "items": {"type": "number"}, "maxItems": 18,
                                      "description": "Bono adicional a mano (Gs) por mes: campañas, premios, acuerdos puntuales."},
        "meses_afectados": {"type": "object", "description": "Variaciones propias de un mes (2 al último): {\"7\": {porta_pct, "
                            "efectividad_pct, pct_bono_efectividad_cobrado, objetivo_co, pct_estado_a, ajuste_comisiones_pct, bonos_activos, "
                            "legajo_incompleto_pct, legajo_no_presentado_pct, pct_caidas_penalizables, recupero_pct, pct_bajas_gross, "
                            "pct_recalculo_productividad, migracion_negocio_pct, comision_por_venta, plus_por_venta, logistica_interior_pct, "
                            "operativo_por_venta, gpon: {objetivo, pct_bono_cobrado, ajuste_comisiones_pct, bonos_activos, cuota2_pct_lineas, "
                            "cuota2_pct_completa, legajo_no_presentado_pct, legajo_pct, mora_pct_lineas, mora_penalidad_pct, pct_recalculo, "
                            "comision_por_venta, plus_por_venta, operativo_por_venta}}}."},
        "gpon": {"type": "object", "description": "GPON por la misma estructura: {activo (true), por_asesor (número o lista por mes; ideal 3), "
                 "objetivo (fija el objetivo del bono fijo; sin esto es vendedores × 3), cambios {parámetros GPON: planes, cuota2_mes, "
                 "cuota2_pct_lineas, cuota2_pct_completa, legajo_no_presentado_pct, legajo_pct, legajo_pct_cuota1, escala_bono, "
                 "pct_bono_cobrado, pct_recalculo, bonos_activos, bono_adicional, mora_pct_lineas, mora_curva_pct, mora_penalidad_pct, "
                 "otros_pct, ajuste_comisiones_pct, costos {comision_por_venta, plus_por_venta, operativo_por_venta, documentacion_por_venta}}, "
                 "bonos_adicionales_por_mes}. {activo: false} excluye GPON."},
    }


async def _simular_anual(ctx: Ctx, e: dict[str, Any]) -> Any:
    escenarios = e.get("escenarios")
    if escenarios:
        if not isinstance(escenarios, list) or not 2 <= len(escenarios) <= 4:
            raise ErrorHerramienta("«escenarios»: de 2 a 4 escenarios, cada uno con «nombre» y sus parámetros (el primero es la base)")
        resumenes: list[tuple[str, dict[str, Any]]] = []
        for i, esc in enumerate(escenarios):
            if not isinstance(esc, dict):
                raise ErrorHerramienta("cada escenario es un objeto")
            nombre = texto(esc.get("nombre"), "el nombre del escenario", 0, 60) or f"Escenario {i + 1}"
            ent = entrada_anual({**{k: v for k, v in e.items() if k != "escenarios"}, **{k: v for k, v in esc.items() if k != "nombre"}})
            resumenes.append((nombre, resumen(ent, correr(ent), con_meses=False)))
        return {"comparacion": comparar(resumenes),
                "escenarios": {n: compactar({k: v for k, v in res.items() if k != "conclusion"}, max_lista=18) for n, res in resumenes},
                "conclusiones": {n: res["conclusion"] for n, res in resumenes},
                "pantalla": PANTALLA_ANUAL, "importante": CONFIDENCIAL}
    ent = entrada_anual(e)
    res = resumen(ent, correr(ent))
    return {**compactar(res, max_lista=18), "entrada_normalizada": _entrada_para_reusar(ent),
            "pantalla": PANTALLA_ANUAL, "importante": CONFIDENCIAL}


def _entrada_para_reusar(ent: dict[str, Any]) -> dict[str, Any]:
    """Lo que hay que mandar a facturacion_guardar_simulacion para guardar exactamente este escenario."""
    g = ent["gpon"]
    out: dict[str, Any] = {"horizonte": ent["horizonte"], "preset": ent["preset"], "ventas_por_mes": ent["ventas_por_mes"]}
    if ent["cambios"]:
        out["cambios"] = ent["cambios"]
    if ent["bono_unico"]:
        out["bono_unico"] = True
    if ent["optimizar"]:
        out["optimizar"] = True
    if ent["bonos_adicionales_por_mes"]:
        out["bonos_adicionales_por_mes"] = ent["bonos_adicionales_por_mes"]
    if ent["nombres_meses"]:
        out["nombres_meses"] = ent["nombres_meses"]
    if ent["meses_afectados"]:
        out["meses_afectados"] = ent["meses_afectados"]
    gp: dict[str, Any] = {"activo": g["activo"]}
    if g["por_asesor_por_mes"] and any(abs(x - GPON_POR_ASESOR_IDEAL) > 1e-9 for x in g["por_asesor_por_mes"]):
        gp["por_asesor"] = g["por_asesor_por_mes"]
    if g["cambios"]:
        gp["cambios"] = g["cambios"]
    if not g["objetivo_auto"]:
        gp["objetivo"] = g["parametros"]["objetivo"]
    out["gpon"] = gp
    return out


# ------------------------------------------------------------------ registro del trabajo
def _foto(ent: dict[str, Any], r: dict[str, Any]) -> dict[str, Any]:
    """La misma foto que guarda la pantalla al guardar (`getSnapshot().resumen`)."""
    a, p = r["anual"], ent["parametros"]
    return {"ventas": a["ventas"], "facturacion_bruta": a["facturacion_bruta"], "ingreso_neto": a["ingreso_neto"], "costos": a["costos"],
            "resultado": a["resultado"], "margen_pct": a["margen_pct"], "resultado_con_cola": a["resultado_con_cola"],
            "bonos_activos": p.get("bonos_activos") is not False, "ajuste_comisiones_pct": float(p.get("ajuste_comisiones_pct") or 0),
            "sin_descuento_bono_productividad": p.get("devolver_bono_productividad") is False,
            "sin_descuento_bono_efectividad": p.get("devolver_bono_efectividad") is False, "bono_unico": bool(p.get("bono_unico")),
            "convergente": bool(r.get("gpon")), "ventas_gpon": a.get("ventas_gpon") or 0, "resultado_gpon": a.get("resultado_gpon") or 0,
            "gpon_por_asesor": a.get("gpon_por_asesor") or 0, "guardada_por": "Voi"}


def _parametros_para_guardar(ent: dict[str, Any]) -> dict[str, Any]:
    """Como los guarda la pantalla: parámetros de pospago + la configuración GPON en «convergente»."""
    g = ent["gpon"]
    return {**ent["parametros"], "convergente": {"activo": g["activo"], "por_asesor_por_mes": g["por_asesor_por_mes"],
                                                 "parametros_gpon": g["parametros"], "objetivo_auto": g["objetivo_auto"]}}


def _notas(v: Any) -> list[dict[str, Any]]:
    if not v:
        return []
    if isinstance(v, str):
        v = [{"texto": v}]
    if not isinstance(v, list):
        raise ErrorHerramienta("«notas» va como lista [{texto, tipo, mes}]")
    out = []
    for n in v[:20]:
        if isinstance(n, str):
            n = {"texto": n}
        if not isinstance(n, dict):
            raise ErrorHerramienta("cada nota es un objeto {texto, tipo, mes}")
        t = texto(n.get("texto"), "el texto de la nota", 3, 4000)
        tipo = str(n.get("tipo") or "observacion").strip().lower()
        if tipo not in TIPOS_NOTA:
            raise ErrorHerramienta(f"tipo de nota: {', '.join(TIPOS_NOTA)}")
        nota: dict[str, Any] = {"texto": t, "tipo": tipo}
        if n.get("mes") is not None:
            nota["mes"] = int(_numero("mes", n.get("mes"), 1))
        out.append(nota)
    return out


def _pantalla_abrir(sid: str) -> str:
    return f"{PANTALLA_ANUAL}?abrir={sid}"


async def _buscar_guardada(ctx: Ctx, referencia: Any) -> FacturacionSimulacion:
    ref = str(referencia or "").strip()
    if not ref:
        raise ErrorHerramienta("Indicá la simulación guardada: su id o parte del nombre.")
    s = await ctx.db.get(FacturacionSimulacion, ref)
    if s:
        return s
    filas = (await ctx.db.execute(select(FacturacionSimulacion).order_by(FacturacionSimulacion.created_at.desc()))).scalars().all()
    candidatas = [x for x in filas if ref.lower() in (x.nombre or "").lower()]
    if len(candidatas) == 1:
        return candidatas[0]
    if not candidatas:
        raise ErrorHerramienta("No encontré una simulación guardada con ese nombre. Pedí la lista con facturacion_simulaciones_guardadas.")
    raise ErrorHerramienta("Hay varias simulaciones con ese nombre: " + "; ".join(f"{x.nombre} (id {x.id})" for x in candidatas[:6]))


def _guardada_dict(s: FacturacionSimulacion, detalle: bool) -> dict[str, Any]:
    d = fact_api.simulacion_dict(s, detalle)
    out: dict[str, Any] = {
        "id": d["id"], "nombre": d["nombre"], "comentario": d["comentario"], "negocio": d["negocio"], "horizonte": d["horizonte"],
        "guardada_por": d["created_by_nombre"], "guardada_el": d["created_at"], "editada_el": d["updated_at"],
        "resumen": d.get("resumen"), "notas": [{k: n.get(k) for k in ("tipo", "texto", "mes", "autor", "fecha")} for n in d.get("notas") or []],
        "cantidad_marcas": len(d.get("marcas") or []), "cantidad_postits": len(d.get("postits") or []),
        "pantalla": _pantalla_abrir(d["id"]),
    }
    if detalle:
        params = dict(d.get("parametros") or {})
        cv = params.pop("convergente", None)
        out["ventas_por_mes"] = d.get("ventas_por_mes")
        out["nombres_meses"] = d.get("nombres_meses")
        out["bonos_adicionales_por_mes"] = d.get("bonos_adicionales_por_mes")
        out["meses_afectados"] = d.get("meses_afectados")
        out["cambios_respecto_calibrado"] = cambios_respecto_calibrado(params)
        out["zafra"] = _lectura_zafra(list(params.get("zafra_pct") or []))
        out["gpon"] = {"activo": bool(cv and cv.get("activo", True)), "por_asesor_por_mes": (cv or {}).get("por_asesor_por_mes"),
                       "objetivo_auto": (cv or {}).get("objetivo_auto", True),
                       "cambios_respecto_calibrado": cambios_respecto_calibrado((cv or {}).get("parametros_gpon") or {}, PARAMETROS_GPON_DEFAULT)}
        out["parametros_clave"] = {k: params.get(k) for k in ("ventas", "objetivo_co", "efectividad_pct", "porta_pct", "ajuste_comisiones_pct",
                                                                "bono_unico", "bonos_activos", "devolver_bono_productividad",
                                                                "devolver_bono_efectividad", "zafra_pct", "escala_productividad") if k in params}
        out["parametros_clave"]["costos"] = {k: (params.get("costos") or {}).get(k) for k in ("ventas_por_vendedor", "comision_por_venta", "plus_por_venta")}
    return out


async def _guardadas(ctx: Ctx, e: dict[str, Any]) -> Any:
    filas = (await ctx.db.execute(select(FacturacionSimulacion).order_by(FacturacionSimulacion.created_at.desc()).limit(40))).scalars().all()
    if not filas:
        return {"simulaciones": [], "mensaje": "No hay simulaciones guardadas todavía.", "pantalla": PANTALLA_ANUAL}
    return {"simulaciones": [compactar(_guardada_dict(s, False), max_lista=8) for s in filas], "total": len(filas),
            "pantalla": PANTALLA_ANUAL, "importante": CONFIDENCIAL}


async def _guardada(ctx: Ctx, e: dict[str, Any]) -> Any:
    s = await _buscar_guardada(ctx, e.get("referencia"))
    d = _guardada_dict(s, True)
    if bool(e.get("recalcular")):
        params = dict(s.parametros or {})
        cv = params.pop("convergente", None) or {}
        gpon = {"activo": cv.get("activo", True), "parametros": cv.get("parametros_gpon"),
                "por_asesor_por_mes": cv.get("por_asesor_por_mes"), "objetivo_auto": cv.get("objetivo_auto", True)}
        af_movil, af_gpon = _separar_afectados(s.meses_afectados or {})
        gpon["meses_afectados"] = af_gpon
        try:
            r = simular_convergente(params, s.ventas_por_mes or [], s.horizonte, af_movil, s.bonos_adicionales_por_mes,
                                    s.nombres_meses, gpon)
        except (TypeError, ValueError, KeyError) as exc:
            raise ErrorHerramienta(f"No se pudo recalcular la simulación guardada: {exc}") from exc
        ent = {"parametros": params, "preset": "guardada", "gpon": gpon}
        d["recalculo"] = compactar(resumen(ent, r), max_lista=18)
    return {**d, "importante": CONFIDENCIAL}


async def _guardar(ctx: Ctx, e: dict[str, Any]) -> Any:
    nombre = texto(e.get("nombre"), "el nombre de la simulación", 3, 160)
    comentario = texto(e.get("comentario"), "el comentario", 0, 4000) or None
    ent = entrada_anual(e)
    r = correr(ent)
    payload = SimulacionCreate(
        nombre=nombre, comentario=comentario, horizonte=ent["horizonte"], parametros=_parametros_para_guardar(ent),
        ventas_por_mes=ent["ventas_por_mes"], meses_afectados=ent["meses_afectados"],
        bonos_adicionales_por_mes=ent["bonos_adicionales_por_mes"], nombres_meses=ent["nombres_meses"],
        notas=_notas(e.get("notas")), resumen=_foto(ent, r),
    )
    s = await llamar(fact_api.crear_simulacion_registro, db=ctx.db, user=ctx.user, payload=payload,
                     ip=ctx.request().client.host if ctx.request().client else None, origen="voi")
    res = resumen(ent, r, con_meses=False)
    return {"ok": True, "id": s.id, "nombre": s.nombre, "pantalla": _pantalla_abrir(s.id),
            "resultado": compactar({k: res[k] for k in ("anual", "por_negocio", "escenario", "estructura_mes_1")}, max_lista=12),
            "conclusion": r["conclusion"],
            "siguiente_paso": "Quedó en el registro del trabajo. Para verla con sus gráficos, abrí la pantalla con abrir_pantalla y la "
                              "ruta de «pantalla» (abre la simulación guardada).",
            "importante": CONFIDENCIAL}


async def _resumen_guardar(ctx: Ctx, e: dict[str, Any]) -> str:
    h = e.get("horizonte") or 12
    return f"Guardar la simulación «{str(e.get('nombre') or '').strip()[:80]}» ({h} meses) en el registro del trabajo de Facturación"


async def _anotar(ctx: Ctx, e: dict[str, Any]) -> Any:
    s = await _buscar_guardada(ctx, e.get("referencia"))
    notas = _notas(e.get("notas"))
    comentario = texto(e.get("comentario"), "el comentario", 0, 4000) if e.get("comentario") is not None else None
    if not notas and comentario is None:
        raise ErrorHerramienta("Indicá «notas» (lista de {texto, tipo}) o un «comentario».")
    s = await llamar(fact_api.anotar_simulacion_registro, db=ctx.db, user=ctx.user, s=s, notas_nuevas=notas,
                     comentario=comentario, ip=None, origen="voi")
    return {"ok": True, "id": s.id, "nombre": s.nombre, "notas": len(s.notas or []), "pantalla": _pantalla_abrir(s.id),
            "importante": CONFIDENCIAL}


async def _resumen_anotar(ctx: Ctx, e: dict[str, Any]) -> str:
    n = len(e.get("notas") or []) if isinstance(e.get("notas"), list) else (1 if e.get("notas") else 0)
    return f"Anotar {n} nota(s) en la simulación guardada «{str(e.get('referencia') or '')[:60]}»"


# ------------------------------------------------------------------ registro de herramientas
def _h(**kw: Any) -> Herramienta:
    return registrar(Herramienta(permisos=(P_FACT,), modos=MODOS_FACT, **kw))


_PROPS = _descripcion_entrada()

_h(nombre="facturacion_simular_anual", etiqueta="Corriendo el simulador convergente", nivel=CONSULTAR,
   descripcion="El simulador anual / convergente de Facturación (el mismo motor y los mismos valores iniciales que la pantalla "
               "Simulador convergente): balance a 12 o 18 meses del pospago vendido por una estructura fija dimensionada con el "
               "mes 1, más el GPON que venden los mismos asesores. Devuelve estructura, totales anuales, cola después del "
               "horizonte, veredicto (gana/pierde con la cola), meses en riesgo y ventas de equilibrio, Gross contra la banda "
               "22–27 %, la lectura de la zafra contra el Ideal, el desglose pospago/GPON, mes a mes y la conclusión. Sin "
               "argumentos corre los valores iniciales de la dirección (1.700 ventas, zafra real, 3 GPON por asesor). Para "
               "«¿qué pasa si…?» mandá `escenarios` (2 a 4, el primero es la base) y te devuelve la comparación con las "
               "diferencias. Usá `preset: ideal` para el IDEAL, `bono_unico` y `optimizar` para la propuesta 2027.",
   esquema=esquema({**_PROPS, "escenarios": {"type": "array", "minItems": 2, "maxItems": 4, "items": {"type": "object"},
                                            "description": "Escenarios a comparar: [{nombre, …mismos campos que arriba}]. Lo de "
                                                           "afuera es común; cada escenario lo sobreescribe."}}),
   fn=_simular_anual)

_h(nombre="facturacion_simulaciones_guardadas", etiqueta="Consultando las simulaciones guardadas", nivel=CONSULTAR,
   descripcion="Las simulaciones guardadas en el registro del trabajo del simulador convergente (nombre, autor, fecha, "
               "horizonte, resultado, notas). Cada una trae la ruta para abrirla en la pantalla.",
   esquema=esquema(), fn=_guardadas)

_h(nombre="facturacion_simulacion_guardada", etiqueta="Abriendo una simulación guardada", nivel=CONSULTAR,
   descripcion="Una simulación guardada a fondo: ventas por mes, qué parámetros difieren de los calibrados, zafra, GPON, "
               "meses afectados, notas y el resultado guardado. Con `recalcular: true` la vuelve a correr con el motor "
               "actual y devuelve el resultado completo (para comparar o explicar). `referencia`: id o parte del nombre.",
   esquema=esquema({"referencia": {"type": "string"}, "recalcular": {"type": "boolean"}}, ["referencia"]), fn=_guardada)

_h(nombre="facturacion_guardar_simulacion", etiqueta="Guardando la simulación en el registro del trabajo", nivel=PROPIO,
   descripcion="Guarda un escenario del simulador convergente en el registro del trabajo (como el botón «Guardar simulación»): "
               "corre el motor con los mismos campos que facturacion_simular_anual (o la `entrada_normalizada` que esa "
               "herramienta devolvió), guarda parámetros, ventas, GPON, meses afectados, notas y la foto del resultado, y queda "
               "auditado. Devuelve la ruta para abrirla en la pantalla con abrir_pantalla. Pedí el nombre si el usuario no lo dio.",
   esquema=esquema({"nombre": {"type": "string", "maxLength": 160}, "comentario": {"type": "string"},
                    "notas": {"type": "array", "maxItems": 20, "items": {"type": "object"},
                              "description": "[{texto, tipo: supuesto|observacion|decision|pendiente|riesgo, mes}]"},
                    **_PROPS}, ["nombre"]),
   fn=_guardar, resumen=_resumen_guardar)

_h(nombre="facturacion_anotar_simulacion", etiqueta="Anotando la simulación guardada", nivel=PROPIO,
   descripcion="Suma notas (supuesto, observación, decisión, pendiente, riesgo; opcionalmente de un mes) o cambia el comentario "
               "de una simulación guardada. Las notas quedan firmadas por el usuario y salen en el PDF. No borra nada.",
   esquema=esquema({"referencia": {"type": "string", "description": "Id o parte del nombre de la simulación guardada."},
                    "notas": {"type": "array", "maxItems": 20, "items": {"type": "object"}},
                    "comentario": {"type": "string"}}, ["referencia"]),
   fn=_anotar, resumen=_resumen_anotar)
