"""Agente de Facturación · Televentas Claro (OpenAI Agents SDK).

Reusa el motor de streaming del Agente de Experiencia (`core.stream_agent`) pero
con instrucciones EXPERTAS en liquidación de comisiones (criterios del Manual TLMK
Fijo PGY) y tools propias sobre los reportes de facturación.
"""
from __future__ import annotations

from typing import Any, Optional

from .....core.config import settings
from .....services.agent import core
from .....services.agent.core import AgentNotConfigured
from .tools import (
    fact_calidad_fecha_impl, fact_comparar_impl, fact_focus_impl, fact_listar_reportes_impl,
    fact_obtener_reporte_impl,
)
from .....services.agent.context import AgentContext

RunContextWrapper = None  # type: ignore  # se setea en _build_facturacion_agent


# Catálogo de criterios del Manual de Esquemas y Conceptos TLMK Fijo PGY (referencia).
CRITERIOS = {
    "chargeback": "Período de 180 días desde la activación. Las penalidades operan dentro de él.",
    "ACTIVACIONES (Upfront, concepto 1 cuota 1)": "1ª comisión por la instalación de la línea.",
    "DIFERIDO (concepto 1 cuota 2)": "2ª cuota; se paga si la línea sigue activa al día 60, si no, importe 0.",
    "LINEA CON DOCUMENTACION FALTANTE (concepto 10)": "Descuenta 50% (legajo incompleto/observado) o 100% (no presentado/rechazado) del upfront+diferido. Control a los 26 días.",
    "AJUSTE LEGAJO (concepto 21)": "Descuenta lo que el concepto 10 no pudo descontar por otra penalidad previa.",
    "REVERSO LINEA DOC FALTANTE (concepto 9)": "Revierte los conceptos 10 y 21 si Control Documental valida el reclamo.",
    "DEVOLUCION DESCUENTO DOCUMENTACION (concepto 56)": "Al día 365 devuelve lo descontado por documentación faltante.",
    "CAMBIO DE PLAN (concepto 3)": "Descuenta la diferencia si el plan destino comisiona menos que el de activación.",
    "CANCELACIONES (concepto 5)": "Por PFI (razón de fraude) descuenta TODA la comisión de activación; cancelación estándar = 0.",
    "SUSPENSIONES (concepto 11)": "Por PFI descuenta TODA la comisión (upfront, diferido, residuales); suspensión estándar = 0.",
    "RECONEXIONES (concepto 15)": "Revierte cancelaciones/suspensiones si la línea se reconecta dentro del chargeback.",
    "REVERSO ACTIVACION (concepto 6)": "Descuenta todo por cancelación tipo 'reverso de activación' o falta de tráfico.",
    "RECUPERO ACTIVACION (concepto 14)": "Revierte el concepto 6.",
    "PENALIZACION POR DEUDA (concepto 7)": "Presuspensión/cancelación por falta de pago o migración a prepago.",
    "REVERSO PENALIZACION POR DEUDA (concepto 13)": "Revierte el concepto 7 (monto 0).",
    "RESIDUAL (concepto 93)": "Comisión residual recurrente (% sobre la línea activa).",
    "INCENTIVO PRODUCTIVIDAD": "Bono por cumplimiento del objetivo de ventas. RECALCULO y DESCUENTO INCENTIVOS lo ajustan a la baja.",
    "PORTABILIDAD": "ACTIVACION PORTABILIDAD NUMERICA (crédito) y DESCUENTO PORTABILIDAD NUMERICA (débito asociado).",
}


_INSTRUCCIONES = """\
Sos el "Agente de Facturación", analista SENIOR experto en la LIQUIDACIÓN DE COMISIONES del \
canal Telemarketing Fijo Paraguay (Claro), operación de Voicenter. Respondés SIEMPRE en español \
rioplatense, ejecutivo, profundo y determinista. Tu estándar es gerencial: no te quedes en describir \
KPIs; explicá POR QUÉ cambia la facturación y QUÉ hacer.

Marco de criterios (Manual TLMK Fijo PGY; `fact_criterios` para la regla exacta):
- Importe = MONTO AFECTADO. Créditos (+) = comisiones; Débitos (−) = penalidades/descuentos. \
Facturación neta = créditos − débitos. Chargeback: 180 días desde la activación.
- Activaciones (upfront) y Diferido; Documentación faltante (descuenta 50/100% del upfront+diferido, \
control a 26 días, REVERSIBLE con el concepto 9 / devolución 56); Suspensiones y Cancelaciones por PFI \
(descuentan TODA la comisión) y Reconexiones (las revierten); Penalización por deuda; Cambio de plan; \
Incentivo de productividad (bono que depende del cumplimiento del OBJETIVO DE VENTAS).

Metodología de análisis PROFUNDO (replicala siempre que haya datos):
1. Separá créditos vs débitos e identificá los DRIVERS: bono/incentivo, suspensiones por PFI, \
documentación faltante y ventas (activaciones).
2. Si hay 2+ meses, DESCOMPONÉ el cambio: cuánto aportó cada driver al delta total (usá la \
`descomposicion` de `fact_comparar`: delta por concepto y % del cambio). Es lo más importante.
3. Bono por venta = incentivo productividad ÷ activaciones del mes. Compará contra los meses altos: \
si baja con ventas estables, la causa es META no alcanzada (driver operativo), no menos ventas.
4. Cohortes: las penalidades (suspensiones PFI, documentación) maduran ~2 meses post-venta. Mirá \
`por_mes_venta` para ubicar la cohorte de origen.
5. Documentación faltante: separá legajos "no presentados" (reversibles, recuperables con Claro/Logística) \
de los demás; estimá el monto recuperable (registros × promedio).
6. Mix de planes y rentabilidad: en `fact_obtener_reporte` usá `plan_mix` (activaciones por plan) y \
`planes_rentables` (ranking por ticket de comisión). Distinguí el plan MÁS vendido del de MAYOR ticket.
7. Curvas diarias: `ventas.por_dia` (curva de ventas) y `suspensiones.por_dia` (suspensiones por fecha) \
para detectar concentraciones; los cierres de fin de mes suelen cargar suspensiones.
8. Calidad por fecha de venta: usá `fact_calidad_fecha` (cruza activaciones vs penalidades por fecha \
ENTRE liquidaciones). Reportá `mayor_calidad` (menor tasa de penalidad) y `menor_calidad` (mayor tasa). \
Solo se rankean cohortes MADURAS (~2 meses); aclará que las fechas recientes ('inmaduras') aún no reflejan \
sus penalidades, así no afirmás que un mes reciente es "el de mejor calidad" sin maduración.
9. Cerrá con ACCIONES operativas concretas y montos recuperables. Usá SIEMPRE "PFI" (no "fraude"). \
Conclusiones deterministas, sin hipótesis especulativas. Comparativos: mínimo 3 meses.

FOCO del usuario:
- Llamá `fact_focus` PRIMERO. Si el usuario seleccionó reportes, centrá TODO el análisis en ellos: \
1 reporte → análisis a fondo de ese mes; 2+ → comparalos con `fact_comparar` y descomponé el cambio.

Datos: NO inventás. Tools: `fact_focus`, `fact_listar_reportes`, `fact_obtener_reporte`, \
`fact_comparar`, `fact_calidad_fecha`, `fact_criterios`. Si no hay reportes, sugerí subir las liquidaciones .txt.

Visualización con `emit_canvas` (panel derecho) — usá EXACTAMENTE estas formas de `datos`:
- KPIs: tipo="kpis", datos={"kpis":[{"label":"Facturación neta","valor":"Gs 600.569.975"},{"label":"Créditos","valor":"Gs 1.329.150.320"}]}
- Barras: tipo="bar", datos={"items":[{"label":"Activaciones","valor":481298181},{"label":"Suspensiones","valor":-183828647}]}
- Líneas (evolución): tipo="line", datos={"items":[{"label":"2026-03","Total":806927914},{"label":"2026-04","Total":904393793}]}
- Tabla: tipo="table", datos={"columnas":["Concepto","Importe"],"filas":[["Activaciones","Gs 481.298.181"]]}
Los valores numéricos de barras/líneas van como NÚMERO (sin "Gs" ni puntos); los de KPIs/tabla pueden ir \
formateados como texto. No pegues tablas gigantes en el texto: mandá el detalle al canvas y resumí los hallazgos.
"""


def _build_facturacion_agent():
    try:
        from agents import Agent, function_tool, set_default_openai_key
        from agents import RunContextWrapper as _RCW
    except ImportError as exc:
        raise AgentNotConfigured("El SDK 'openai-agents' no está instalado en el servidor.") from exc

    globals()["RunContextWrapper"] = _RCW
    if not settings.openai_api_key:
        raise AgentNotConfigured("Falta OPENAI_API_KEY en la configuración del servidor.")
    set_default_openai_key(settings.openai_api_key)

    @function_tool
    async def fact_listar_reportes(ctx: RunContextWrapper[AgentContext]) -> dict:
        """Lista los reportes de facturación disponibles (período, liquidación, total, créditos,
        débitos, ventas, estado de publicación)."""
        return await fact_listar_reportes_impl()

    @function_tool
    async def fact_focus(ctx: RunContextWrapper[AgentContext]) -> dict:
        """Devuelve los reportes que el usuario SELECCIONÓ como foco. Llamala PRIMERO: si hay
        reportes en foco, tu análisis debe centrarse en ellos (uno → análisis a fondo; 2+ → comparar)."""
        return await fact_focus_impl(ctx.context.focus_refs)

    @function_tool
    async def fact_obtener_reporte(ctx: RunContextWrapper[AgentContext], referencia: Optional[str] = None) -> dict:
        """Detalle de un reporte: KPIs, TODAS las descripciones de concepto, ventas, suspensiones (PFI)
        y documentación faltante por cohorte de venta. `referencia`: período YYYY-MM, número de
        liquidación, id, o 'ultimo'. Sin referencia: usa el reporte en foco (o el más reciente)."""
        return await fact_obtener_reporte_impl(referencia, ctx.context.focus_refs)

    @function_tool(strict_mode=False)
    async def fact_comparar(ctx: RunContextWrapper[AgentContext], referencias: Optional[list[str]] = None) -> dict:
        """Compara 2+ reportes: matriz por concepto, panel de drivers, variaciones y la DESCOMPOSICIÓN
        del cambio del último mes vs el anterior (delta por concepto y % del cambio). Sin `referencias`,
        usa los reportes en foco. Pasá períodos YYYY-MM, números de liquidación o ids."""
        return await fact_comparar_impl(referencias, ctx.context.focus_refs)

    @function_tool(strict_mode=False)
    async def fact_calidad_fecha(ctx: RunContextWrapper[AgentContext], referencias: Optional[list[str]] = None) -> dict:
        """Cruza activaciones vs penalidades por FECHA de venta entre 2+ liquidaciones para identificar
        las fechas de ventas de MAYOR y MENOR calidad (tasa de penalidad). Sin `referencias` usa el foco
        o todos los reportes. Requiere ≥2 meses (idealmente con ~2 de maduración por el chargeback)."""
        return await fact_calidad_fecha_impl(referencias, ctx.context.focus_refs)

    @function_tool
    async def fact_criterios(ctx: RunContextWrapper[AgentContext], concepto: Optional[str] = None) -> dict:
        """Devuelve los criterios del Manual TLMK Fijo PGY. Sin `concepto`: catálogo completo.
        Con `concepto`: las entradas que coincidan (para citar la regla exacta)."""
        if not concepto:
            return {"criterios": CRITERIOS}
        q = concepto.strip().lower()
        match = {k: v for k, v in CRITERIOS.items() if q in k.lower() or q in v.lower()}
        return {"criterios": match or CRITERIOS}

    @function_tool(strict_mode=False)
    async def emit_canvas(ctx: RunContextWrapper[AgentContext], tipo: str, titulo: str, datos: dict,
                          descripcion: Optional[str] = None) -> dict:
        """Dibuja un artefacto en el canvas (panel derecho). `tipo`: 'bar' | 'stacked-bar' | 'line' |
        'area' | 'donut' | 'table' | 'kpis' | 'markdown'. `datos` según el tipo (igual que el agente
        de Atención). Devuelve el id del artefacto."""
        artifact = {
            "id": f"art{len(ctx.context.canvas) + 1}",
            "tipo": tipo, "titulo": titulo, "descripcion": descripcion, "datos": datos,
        }
        ctx.context.canvas.append(artifact)
        return {"ok": True, "artifact_id": artifact["id"]}

    tools = [fact_focus, fact_listar_reportes, fact_obtener_reporte, fact_comparar,
             fact_calidad_fecha, fact_criterios, emit_canvas]

    model_settings = core.build_model_settings()

    kwargs: dict[str, Any] = dict(
        name="Agente de Facturación",
        instructions=_INSTRUCCIONES,
        model=settings.agent_model,
        tools=tools,
    )
    if model_settings is not None:
        kwargs["model_settings"] = model_settings
    return Agent(**kwargs)


async def stream_facturacion_agent(messages: list[dict], context: AgentContext):
    """Streaming del Agente de Facturación (reusa el loop de `core.stream_agent`)."""
    async for ev in core.stream_agent(messages, context, build_fn=_build_facturacion_agent):
        yield ev
