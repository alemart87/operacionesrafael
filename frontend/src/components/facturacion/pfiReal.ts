/** PFI real (primera factura impaga, razón Claro P9-735) medido en las 8 liquidaciones de pospago 2026
 *  (385 a 392, enero a agosto). Por cohorte de venta: líneas a las que Claro descontó por PFI ÷ activaciones
 *  del mismo mes, sumando todas las liquidaciones posteriores. `liq` = liquidaciones posteriores observadas
 *  (la suspensión llega a los ~60 días: con menos de 3 la cohorte todavía no está completa). */
export const PFI_REAL_COHORTES: { mes: string; activaciones: number; lineas: number; pct: number; pctFact: number; liq: number }[] = [
  { mes: "ene-26", activaciones: 1918, lineas: 516, pct: 26.9, pctFact: 21.7, liq: 7 },
  { mes: "feb-26", activaciones: 1825, lineas: 520, pct: 28.5, pctFact: 24.3, liq: 6 },
  { mes: "mar-26", activaciones: 1928, lineas: 554, pct: 28.7, pctFact: 20.3, liq: 5 },
  { mes: "abr-26", activaciones: 1913, lineas: 676, pct: 35.3, pctFact: 21.3, liq: 4 },
  { mes: "may-26", activaciones: 1832, lineas: 689, pct: 37.6, pctFact: 26.9, liq: 3 },
  { mes: "jun-26", activaciones: 1925, lineas: 586, pct: 30.4, pctFact: 18.0, liq: 2 },
];

/** Cuándo llega la suspensión por PFI, en días desde la activación (4.882 líneas). */
export const PFI_DIAS = { p10: 57, mediana: 60, p90: 83 };

/** PFI neto ÷ facturación por ventas en las 8 liquidaciones (lo que se descontó cada mes, sin importar cuándo se vendió). */
export const PFI_REAL_LIQUIDACIONES = { desde: "ene-26", hasta: "ago-26", pctFactTotal: 23.7, porActivacion: 145000 };

/** Cohortes maduras (3 o más liquidaciones posteriores). */
export function pfiCohortesMaduras() {
  return PFI_REAL_COHORTES.filter((c) => c.liq >= 3);
}
