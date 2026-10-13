"""Presets del simulador anual de pospago, espejo exacto de `frontend/src/components/facturacion/presets.ts`.

Los usa Voi para reproducir en el motor lo mismo que hacen los botones de la pantalla (IDEAL, valores iniciales,
Bono único propuesto, Optimizar). Si cambia el archivo del frontend, cambia este.

- IDEAL: escenario objetivo definido por la dirección (ventas y objetivo, zafra ideal, estructura).
- INICIAL: lo que carga el simulador anual al abrir (el IDEAL sin la zafra: la zafra inicial es la real, calibrada).
- BONO ÚNICO (propuesta 2027): un solo bono por línea que reemplaza a productividad + efectividad, escalonado por el
  cumplimiento del objetivo CO y sin descuento en las caídas.
- OPTIMIZAR: +40 % sobre cuota 1, cuota 2 y plus de portabilidad (editable después).
"""
from __future__ import annotations

import copy
from typing import Any

ZAFRA_IDEAL: list[float] = [99.9, 82.6, 75, 70, 67, 63, 60, 58, 56, 54, 53, 51, 49]
ZAFRA_TOLERANCIA = 3.5           # banda del Ideal en el gráfico de la zafra (± puntos)
GROSS_BANDA = (22.0, 27.0)       # %Gross/Vta de referencia (otros calls: 12 a 27 %)

PRESET_IDEAL_MOVIL: dict[str, Any] = {
    "ventas": 1700,
    "efectividad_pct": 85,
    "pct_bono_efectividad_cobrado": 87.5,
    "objetivo_co": 1700,
    "pct_estado_a": 100,
    "porta_pct": 90,
    "bono_adicional": 0,
    "zafra_pct": list(ZAFRA_IDEAL),
    "costos": {
        "ventas_por_vendedor": 17,
        "supervisor_cada_vendedores": 14,
        "backoffice_cada_ventas": 180,
        "coordinadores": 1,
        "controllers": 2,
        "salario_hora": 14635,
        "horas_dia": 7,
        "dias_mes": 23,
        "comision_por_venta": 95000,
        "plus_por_venta": 12500,
    },
}

PRESET_INICIAL_MOVIL: dict[str, Any] = {k: v for k, v in PRESET_IDEAL_MOVIL.items() if k != "zafra_pct"}

BONO_UNICO_ESCALA: list[dict[str, float]] = [
    {"desde_pct": 110, "monto": 55000},
    {"desde_pct": 100, "monto": 50000},
    {"desde_pct": 95, "monto": 35000},
    {"desde_pct": 90, "monto": 25000},
]

AJUSTE_OPTIMIZAR_PCT = 40.0


def aplicar_preset(base: dict[str, Any], preset: dict[str, Any]) -> dict[str, Any]:
    """Aplica un preset sobre los parámetros (los costos se mezclan campo a campo). Devuelve una copia."""
    out = copy.deepcopy(base)
    for k, v in preset.items():
        if k == "costos":
            out["costos"] = {**out.get("costos", {}), **copy.deepcopy(v)}
        else:
            out[k] = copy.deepcopy(v)
    return out


def aplicar_bono_unico(p: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(p)
    out["bono_unico"] = True
    out["escala_productividad"] = [dict(e) for e in BONO_UNICO_ESCALA]
    out["escala_efectividad"] = [{"desde_pct": 0, "monto": 0}]      # el bono efectividad queda dentro del único
    out["devolver_bono_productividad"] = False
    out["devolver_bono_efectividad"] = False
    return out


def quitar_bono_unico(p: dict[str, Any], defaults: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(p)
    out["bono_unico"] = False
    out["escala_productividad"] = [dict(e) for e in defaults.get("escala_productividad", p.get("escala_productividad", []))]
    out["escala_efectividad"] = [dict(e) for e in defaults.get("escala_efectividad", p.get("escala_efectividad", []))]
    out["devolver_bono_productividad"] = True
    out["devolver_bono_efectividad"] = True
    return out


def coincide_preset(p: dict[str, Any] | None, preset: dict[str, Any]) -> bool:
    """¿Los parámetros coinciden con el preset en los campos que el preset define?"""
    if not p:
        return False
    for k, v in preset.items():
        if k == "costos":
            for ck, cv in v.items():
                if float((p.get("costos") or {}).get(ck, 0) or 0) != float(cv):
                    return False
        elif isinstance(v, list):
            if [float(x) for x in (p.get(k) or [])] != [float(x) for x in v]:
                return False
        elif float(p.get(k, 0) or 0) != float(v):
            return False
    return True
