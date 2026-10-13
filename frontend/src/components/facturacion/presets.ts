/** Presets del simulador de pospago (móvil).
 *  - IDEAL: escenario objetivo definido por la dirección (ventas y objetivo, zafra ideal, estructura).
 *  - INICIAL: lo que carga el simulador anual al abrir (ventas/objetivo y costos del IDEAL; la zafra
 *    queda la real, calibrada con las liquidaciones).
 *  "Restaurar valores reales" sigue devolviendo los parámetros calibrados del backend. */

export const ZAFRA_IDEAL = [99.9, 82.6, 75, 70, 67, 63, 60, 58, 56, 54, 53, 51, 49];

export const PRESET_IDEAL_MOVIL: Record<string, any> = {
  ventas: 1700,
  efectividad_pct: 85,
  pct_bono_efectividad_cobrado: 87.5,
  objetivo_co: 1700,
  pct_estado_a: 100,
  porta_pct: 90,
  bono_adicional: 0,
  zafra_pct: ZAFRA_IDEAL,
  costos: {
    ventas_por_vendedor: 17,
    supervisor_cada_vendedores: 14,
    backoffice_cada_ventas: 180,
    coordinadores: 1,
    controllers: 2,
    salario_hora: 14635,
    horas_dia: 7,
    dias_mes: 23,
    comision_por_venta: 95000,
    plus_por_venta: 12500,
  },
};

/** Valores iniciales del simulador anual: el IDEAL sin la zafra (la zafra inicial es la real). */
export const PRESET_INICIAL_MOVIL: Record<string, any> = (() => {
  const { zafra_pct: _z, ...resto } = PRESET_IDEAL_MOVIL;
  return resto;
})();

/** Propuesta 2027 · BONO ÚNICO: un solo bono por línea que reemplaza a productividad + efectividad,
 *  escalonado por cumplimiento del objetivo CO y SIN descuento en las caídas. */
export const BONO_UNICO_ESCALA = [
  { desde_pct: 110, monto: 55000 },
  { desde_pct: 100, monto: 50000 },
  { desde_pct: 95, monto: 35000 },
  { desde_pct: 90, monto: 25000 },
];

/** Propuesta 2027 · mejora de comisiones (cuota 1, cuota 2 y porta) que carga el botón "Optimizar". Editable después. */
export const AJUSTE_OPTIMIZAR_PCT = 40;

export function aplicarBonoUnico(p: any) {
  if (!p) return p;
  return {
    ...p,
    bono_unico: true,
    escala_productividad: BONO_UNICO_ESCALA.map((e) => ({ ...e })),
    escala_efectividad: [{ desde_pct: 0, monto: 0 }],     // el bono efectividad desaparece: queda dentro del único
    devolver_bono_productividad: false,
    devolver_bono_efectividad: false,
  };
}

export function quitarBonoUnico(p: any, defaults: any) {
  if (!p) return p;
  return {
    ...p,
    bono_unico: false,
    escala_productividad: (defaults?.escala_productividad ?? p.escala_productividad).map((e: any) => ({ ...e })),
    escala_efectividad: (defaults?.escala_efectividad ?? p.escala_efectividad).map((e: any) => ({ ...e })),
    devolver_bono_productividad: true,
    devolver_bono_efectividad: true,
  };
}

/** Aplica un preset sobre los parámetros actuales (los costos se mezclan campo a campo). */
export function aplicarPreset(base: any, preset: Record<string, any>) {
  if (!base) return base;
  const { costos, ...plano } = preset;
  return { ...base, ...plano, costos: { ...(base.costos ?? {}), ...(costos ?? {}) } };
}

/** ¿Los parámetros actuales coinciden con el preset (en los campos que el preset define)? */
export function coincidePreset(p: any, preset: Record<string, any>): boolean {
  if (!p) return false;
  const eq = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
  for (const [k, v] of Object.entries(preset)) {
    if (k === "costos") {
      for (const [ck, cv] of Object.entries(v as Record<string, any>)) if (!eq(Number(p.costos?.[ck]), Number(cv))) return false;
    } else if (Array.isArray(v)) {
      if (!eq((p[k] ?? []).map(Number), v.map(Number))) return false;
    } else if (!eq(Number(p[k] ?? 0), Number(v))) return false;
  }
  return true;
}
