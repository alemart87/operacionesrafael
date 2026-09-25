/**
 * Datos de la Guía del auditor.
 *
 * Las reglas vigentes las expone el backend (GET /auditoria/parametros): son las mismas
 * con las que el motor clasifica vendedores, arma señales y levanta alertas. Los valores
 * de REGLAS_REFERENCIA solo se usan si la API no responde, y la guía lo avisa.
 */

export interface Regla { min: number; pct: number }

export interface ReglasAuditoria {
  umbral_uso_pct: number;
  min_lineas_alerta: number;
  dias_sin_uso_antigua: number;
  umbral_sin_uso_atencion: number;
  umbral_sin_uso_critico: number;
  analysis_version: number;
  nivel_critico: { sin_uso_antiguas: number; sali_sin_uso: number; suspendidas: number };
  nivel_atencion: { sin_uso_antiguas: number; sali_sin_uso: number; suspendidas: number; sin_uso_riesgo_A: number };
  pesos: { sin_uso_antigua: number; sin_uso_reciente: number; sali_sin_uso: number; suspendida: number; sin_uso_riesgo_A: number; alerta_uso: number };
  senal_alta_desde: { sin_uso_antiguas: number; sali_sin_uso: number; suspendidas: number };
  patrones: {
    sin_uso_mismo_dia: Regla; pospago_mismo_dia: Regla; sin_uso_mismo_plan: Regla;
    sin_uso_mismo_origen: Regla; nativas_sin_uso: Regla; sin_uso_misma_ciudad: Regla;
  };
  llamativos: {
    sali_pct_sin_uso_alta: number; pendientes_dias: number; pendientes_viejas_media: number;
    concentracion_top: number; concentracion_pct_media: number; dia_sin_uso_min: number;
  };
  max_hallazgos_vendedor: number;
  max_evidencia: number;
}

export const REGLAS_REFERENCIA: ReglasAuditoria = {
  umbral_uso_pct: 50, min_lineas_alerta: 5, dias_sin_uso_antigua: 3, umbral_sin_uso_atencion: 15, umbral_sin_uso_critico: 30, analysis_version: 5,
  nivel_critico: { sin_uso_antiguas: 5, sali_sin_uso: 5, suspendidas: 3 },
  nivel_atencion: { sin_uso_antiguas: 3, sali_sin_uso: 3, suspendidas: 1, sin_uso_riesgo_A: 2 },
  pesos: { sin_uso_antigua: 3, sin_uso_reciente: 1, sali_sin_uso: 3, suspendida: 2, sin_uso_riesgo_A: 2, alerta_uso: 8 },
  senal_alta_desde: { sin_uso_antiguas: 3, sali_sin_uso: 3, suspendidas: 2 },
  patrones: {
    sin_uso_mismo_dia: { min: 3, pct: 50 }, pospago_mismo_dia: { min: 6, pct: 40 }, sin_uso_mismo_plan: { min: 3, pct: 70 },
    sin_uso_mismo_origen: { min: 3, pct: 70 }, nativas_sin_uso: { min: 3, pct: 60 }, sin_uso_misma_ciudad: { min: 4, pct: 75 },
  },
  llamativos: { sali_pct_sin_uso_alta: 50, pendientes_dias: 7, pendientes_viejas_media: 20, concentracion_top: 5, concentracion_pct_media: 40, dia_sin_uso_min: 10 },
  max_hallazgos_vendedor: 30, max_evidencia: 60,
};

/** Combina lo que devolvió la API con la referencia (clave por clave, también en los grupos anidados). */
export function combinarReglas(api: Partial<ReglasAuditoria> | null | undefined): ReglasAuditoria {
  if (!api) return REGLAS_REFERENCIA;
  const out: any = { ...REGLAS_REFERENCIA };
  for (const [k, v] of Object.entries(api)) {
    const base = (REGLAS_REFERENCIA as any)[k];
    out[k] = v && typeof v === "object" && base && typeof base === "object" ? { ...base, ...v } : v ?? base;
  }
  if (api.patrones) for (const [k, v] of Object.entries(api.patrones)) out.patrones[k] = { ...(REGLAS_REFERENCIA.patrones as any)[k], ...v };
  return out as ReglasAuditoria;
}

/** Días hasta la suspensión por PFI (referencia operativa: ~60 días desde la venta). */
export const DIAS_PFI = 60;

/**
 * Caso testigo: el corte real de septiembre 2026 (publicado, al 22/09/2026). Solo cifras
 * agregadas, sin vendedores ni líneas, para que los ejemplos de la guía sean reales.
 */
export const CASO_TESTIGO = {
  corte: "22/09/2026",
  periodo: "septiembre 2026",
  netas: 1183, pospago: 1000, pospago_sin_uso: 205, pct_sin_uso: 20.5, sin_uso_antiguas: 105, total_sin_uso: 314,
  cargas: 1433, finalizadas_sin_activar: 201, pendientes: 155, pendientes_viejas: 66, suspendidas: 19,
  vendedores: { total: 101, criticos: 18, atencion: 25 },
  sali: {
    total: 113, sin_uso: 109, pct: 96.5, origen: [["TIGO", 73], ["PERS", 40]] as [string, number][],
    /** [día, activaciones] del mes anterior. */
    activacion: [["2026-08-25", 1], ["2026-08-26", 0], ["2026-08-27", 0], ["2026-08-28", 5], ["2026-08-29", 68], ["2026-08-30", 5], ["2026-08-31", 34]] as [string, number][],
    /** [día, sin uso, con uso] por fecha de portación. */
    portacion: [
      ["2026-09-01", 62, 0], ["2026-09-02", 25, 2], ["2026-09-03", 5, 1], ["2026-09-04", 2, 0], ["2026-09-05", 0, 0], ["2026-09-06", 0, 0],
      ["2026-09-07", 1, 0], ["2026-09-08", 7, 0], ["2026-09-09", 0, 0], ["2026-09-10", 2, 0], ["2026-09-11", 2, 0], ["2026-09-12", 0, 0],
      ["2026-09-13", 0, 0], ["2026-09-14", 0, 0], ["2026-09-15", 1, 0], ["2026-09-16", 0, 0], ["2026-09-17", 0, 1], ["2026-09-18", 2, 0],
    ] as [string, number, number][],
  },
  riesgo: [
    { r: "A", label: "Alto", cargas: 135, con_uso: 60, sin_uso: 22, pct: 26.8 },
    { r: "M", label: "Medio", cargas: 1186, con_uso: 618, sin_uso: 137, pct: 18.1 },
    { r: "B", label: "Bajo", cargas: 112, con_uso: 52, sin_uso: 17, pct: 24.6 },
  ],
  zonas: { interior: { cargas: 493, pct: 28.1 }, capital: { cargas: 940, pct: 12.7 } },
};

/** Número con separador de miles y coma decimal (es-PY). */
export const fmt = (v: number) => v.toLocaleString("es-PY", { maximumFractionDigits: 1 });
