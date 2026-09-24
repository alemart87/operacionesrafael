"use client";

import type { Artifact } from "@/components/agent/CanvasArtifact";

const esc = (s: any) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const CHART_TYPES = ["bar", "stacked-bar", "stacked_bar", "line", "area", "donut"];

function svgFromCard(id: string): string {
  const card = document.getElementById(`art-card-${id}`);
  const svg = card?.querySelector("svg");
  if (!svg) return "";
  const clone = svg.cloneNode(true) as SVGElement;
  const rect = svg.getBoundingClientRect();
  clone.setAttribute("width", String(Math.round(rect.width)));
  clone.setAttribute("height", String(Math.round(rect.height)));
  clone.setAttribute("style", "max-width:100%;height:auto;");
  return new XMLSerializer().serializeToString(clone);
}

function tableHtml(datos: any): string {
  const cols: any[] = datos?.columnas || datos?.columns || [];
  const rows: any[][] = datos?.filas || datos?.rows || [];
  if (!cols.length) return "";
  return `<table><thead><tr>${cols.map((c, i) => `<th class="${i === 0 ? "l" : "r"}">${esc(c)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((cell, i) => `<td class="${i === 0 ? "l" : "r"}">${esc(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function kpisHtml(datos: any): string {
  const kpis: any[] = datos?.kpis || [];
  return `<div class="kpis">${kpis.map((k) =>
    `<div class="kpi"><div class="kl">${esc(k.label)}</div><div class="kv">${esc(k.valor ?? k.value)}</div>${k.hint ? `<div class="kh">${esc(k.hint)}</div>` : ""}</div>`).join("")}</div>`;
}

function sectionHtml(a: Artifact): string {
  let body = "";
  if (CHART_TYPES.includes(a.tipo)) {
    const svg = svgFromCard(a.id);
    body = svg ? `<div class="chart">${svg}</div>` : tableHtml(a.datos);
  } else if (a.tipo === "table") {
    body = tableHtml(a.datos);
  } else if (a.tipo === "kpis") {
    body = kpisHtml(a.datos);
  } else {
    body = `<div class="md">${esc(a.datos?.texto || a.datos?.markdown || a.datos?.text || "")}</div>`;
  }
  return `<section class="card"><h2>${esc(a.titulo)}</h2>${a.descripcion ? `<p class="desc">${esc(a.descripcion)}</p>` : ""}${body}</section>`;
}

const CSS = `
*{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#1f2733;margin:0;background:#f3f4f6}
.toolbar{position:sticky;top:0;background:#fff;border-bottom:1px solid #e5e7eb;padding:10px 24px;text-align:right}
.toolbar button{background:#E6332A;color:#fff;border:0;border-radius:6px;padding:9px 18px;font-weight:700;cursor:pointer;font-size:13px}
.rep-header{display:flex;align-items:center;gap:20px;padding:24px;border-top:5px solid #E6332A;background:#fff;margin:0}
.rep-header .brand{font-weight:800;letter-spacing:.5px;color:#E6332A;font-size:22px}
.rep-header .ttl .k{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#64748b;font-weight:700}
.rep-header h1{margin:2px 0;font-size:22px;color:#0f172a;text-transform:uppercase}
.rep-header .meta{font-size:12px;color:#64748b}
main{padding:20px 24px;max-width:920px;margin:0 auto}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:18px;margin:0 0 16px}
.card h2{margin:0 0 4px;font-size:15px;text-transform:uppercase;color:#0f172a}
.card .desc{margin:0 0 12px;font-size:12px;color:#64748b}
.chart{text-align:center}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{border:1px solid #e5e7eb;padding:6px 10px}
th{background:#f8fafc;text-transform:uppercase;font-size:11px;letter-spacing:1px;color:#475569}
.l{text-align:left}.r{text-align:right}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.kpi{border-left:3px solid #00B2BF;background:#f8fafc;border-radius:6px;padding:10px}
.kpi .kl{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#64748b;font-weight:700}
.kpi .kv{font-size:22px;color:#0f172a;font-weight:700;margin-top:2px}
.kpi .kh{font-size:11px;color:#64748b;margin-top:2px}
.md{white-space:pre-wrap;font-size:13px;line-height:1.5}
.rep-footer{text-align:center;font-size:11px;color:#94a3b8;padding:18px;text-transform:uppercase;letter-spacing:1px}
@media print{
  body{background:#fff}
  .no-print{display:none!important}
  @page{size:A4;margin:14mm}
  .card{break-inside:avoid;page-break-inside:avoid}
  .rep-header{padding:0 0 12px}
  main{padding:0}
}
`;

export function downloadCanvasHtml(artifacts: Artifact[], meta: { title?: string; month?: string }) {
  const fecha = new Date().toLocaleString("es-PY");
  const sections = artifacts.map(sectionHtml).join("\n") || "<p>Sin artefactos.</p>";
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(meta.title || "Agente de Experiencia")}</title><style>${CSS}</style></head>
<body>
<div class="toolbar no-print"><button onclick="window.print()">🖨 Imprimir / Guardar como PDF</button></div>
<header class="rep-header"><div class="brand">voicenter</div>
<div class="ttl"><div class="k">Agente de Experiencia</div><h1>${esc(meta.title || "Informe")}</h1>
<div class="meta">Atención al Cliente${meta.month ? ` · ${esc(meta.month)}` : ""} · ${esc(fecha)}</div></div></header>
<main>${sections}</main>
<footer class="rep-footer">Operado por Voicenter S.A. · Sudameris Seguros</footer>
</body></html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `agente-experiencia-${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
