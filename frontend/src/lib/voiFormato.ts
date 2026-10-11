/** Formatos de números del lienzo de Voi (es-PY: punto de miles, coma decimal). */
export type FormatoVoi = "numero" | "decimal" | "porcentaje" | "guaranies" | "dolares" | "texto";

const nf = (min: number, max: number) => new Intl.NumberFormat("es-PY", { minimumFractionDigits: min, maximumFractionDigits: max });
const ENTERO = nf(0, 0);
const DECIMAL = nf(0, 1);
const DOS = nf(2, 2);

export function formatear(v: number | null | undefined, formato: FormatoVoi = "numero"): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  switch (formato) {
    case "decimal":
      return DECIMAL.format(v);
    case "porcentaje":
      return `${DECIMAL.format(v)} %`;
    case "guaranies":
      return `Gs. ${ENTERO.format(Math.round(v))}`;
    case "dolares":
      return `US$ ${DOS.format(v)}`;
    case "numero":
      return Math.abs(v) < 100 && !Number.isInteger(v) ? DECIMAL.format(v) : ENTERO.format(Math.round(v));
    default:
      return String(v);
  }
}

/** Para los ejes: compacto (12,5 mil · 3,4 M) y con la unidad del formato. */
export function formatearEje(v: number, formato: FormatoVoi = "numero"): string {
  const abs = Math.abs(v);
  const compacto = abs >= 1e6 ? `${DECIMAL.format(v / 1e6)} M` : abs >= 1e4 ? `${DECIMAL.format(v / 1e3)} mil` : formatear(v, formato === "dolares" ? "decimal" : formato === "guaranies" ? "numero" : formato);
  if (formato === "porcentaje") return abs >= 1e4 ? `${compacto} %` : compacto;
  if (formato === "guaranies") return `Gs. ${compacto}`;
  if (formato === "dolares") return `US$ ${compacto}`;
  return compacto;
}

/** ¿El texto de una celda es un número? (para alinear a la derecha en las tablas del chat). */
export function pareceNumero(t: string): boolean {
  const s = t.trim().replace(/^(Gs\.|US\$)\s*/i, "").replace(/\s*%$/, "");
  return s !== "" && /^[-+]?[\d.,]+$/.test(s) && /\d/.test(s);
}

/** Convierte «1.234,5», «12,4 %» o «Gs. 1.000» a número (para ordenar tablas). */
export function aNumero(t: unknown): number | null {
  if (typeof t === "number") return t;
  if (typeof t !== "string") return null;
  let s = t.trim().replace(/^(Gs\.|US\$)\s*/i, "").replace(/\s*%$/, "").replace(/\s/g, "");
  if (!s || !/\d/.test(s)) return null;
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  else if ((s.match(/\./g) || []).length > 1 || /^\d{1,3}\.\d{3}$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
