export function formatGs(n: number | string | null | undefined): string {
  if (n == null) return "Gs 0";
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (Number.isNaN(num)) return "Gs 0";
  return "Gs " + num.toLocaleString("es-PY", { maximumFractionDigits: 0 });
}

export function formatPct(n: number | null | undefined, decimals = 1): string {
  if (n == null) return "0%";
  return `${n.toFixed(decimals)}%`;
}

export function formatInt(n: number | null | undefined): string {
  if (n == null) return "0";
  return n.toLocaleString("es-PY");
}

export function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("es-PY");
  } catch {
    return s;
  }
}
