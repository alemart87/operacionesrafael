/**
 * Descarga de CSV para Excel en español: separador ";", BOM UTF-8 y celdas
 * protegidas contra fórmulas (un texto que empieza con = + - @ se abriría como
 * fórmula en Excel; se le antepone un apóstrofo). Los números se pasan como
 * número y no se tocan.
 */
export type Celda = string | number | null | undefined;

function celda(v: Celda): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "number" ? v.toLocaleString("es-PY", { useGrouping: false, maximumFractionDigits: 2 }) : String(v);
  if (typeof v !== "number" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function descargarCsv(nombre: string, cabecera: string[], filas: Celda[][]): void {
  const texto = "﻿" + [cabecera, ...filas].map((f) => f.map(celda).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nombre });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
