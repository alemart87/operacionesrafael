/**
 * Patrón de comportamiento de las ventas de un vendedor, calculado a partir de
 * sus líneas del informe (sin IA). Cada señal es una etiqueta corta con su
 * gravedad, pensada para leer de un vistazo en la lista de críticos y en la ficha.
 */
import { fechaCorta, type DetalleNeta, type InformeData, type Vendedor } from "./tipos";

export type Gravedad = "alta" | "media" | "info";
export interface Senal {
  gravedad: Gravedad;
  texto: string;
}

/**
 * Días desde la activación hasta el corte a partir de los cuales una línea sin consumo es alerta.
 * Antes está "en espera de uso": todavía no tuvo tiempo de usarse y no cuenta como sin uso.
 */
export const DIAS_SIN_USO_ANTIGUA = 3;

const dias = (desde: string | null, hasta: string | null) => {
  if (!desde || !hasta) return 0;
  return Math.round((Date.parse(hasta) - Date.parse(desde)) / 86400000);
};

/** Estado de uso de una línea: el backend lo marca (v6+); para informes viejos se deduce de las fechas. */
export function estadoUso(r: DetalleNeta, corte: string | null): "SI" | "NO" | "ESPERA" | null {
  if (r.consumo === null || r.consumo === undefined) return null;
  if (r.consumo === "SI") return "SI";
  const espera = r.en_espera ?? (!!r.fecha_activacion && !!corte && dias(r.fecha_activacion, corte) < DIAS_SIN_USO_ANTIGUA);
  return espera ? "ESPERA" : "NO";
}

const pctDe = (parte: number, total: number) => (total ? Math.round((parte / total) * 100) : 0);

const top = <T,>(rows: T[], key: (r: T) => string | null | undefined) => {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
};

export interface PatronVendedor {
  senales: Senal[];
  /** Pospago sin uso activadas hace DIAS_SIN_USO_ANTIGUA días o más: alerta PFI firme. */
  sinUsoAntiguas: number;
  /** Pospago en espera de uso (activadas hace menos de DIAS_SIN_USO_ANTIGUA días): no son alerta. */
  enEspera: number;
  /** Puntaje para ordenar la lista de críticos (más alto = más crítico). */
  puntaje: number;
}

export function patronVendedor(d: InformeData, v: Vendedor, lineas: DetalleNeta[]): PatronVendedor {
  const k = d.kpis;
  const corte = k.fecha_dato;
  const pospago = lineas.filter((r) => r.producto === "Pospago");
  const sinUso = pospago.filter((r) => estadoUso(r, corte) === "NO");
  const sinUsoAntiguas = sinUso.length;
  const enEspera = pospago.filter((r) => estadoUso(r, corte) === "ESPERA").length;
  const senales: Senal[] = [];

  if (v.alerta) senales.push({ gravedad: "alta", texto: `${v.pct_uso.toLocaleString("es-PY", { maximumFractionDigits: 1 })}% en uso: bajo el umbral de ${k.umbral_uso_pct}%` });
  if (sinUsoAntiguas) {
    senales.push({
      gravedad: sinUsoAntiguas >= 3 ? "alta" : "media",
      texto: `${sinUsoAntiguas} sin uso con ${DIAS_SIN_USO_ANTIGUA}+ días desde la activación`,
    });
  }
  if (enEspera) {
    senales.push({ gravedad: "info", texto: `${enEspera} en espera de uso: activada${enEspera > 1 ? "s" : ""} hace menos de ${DIAS_SIN_USO_ANTIGUA} días, no es alerta` });
  }

  // Concentración en un día: muchas ventas el mismo día y con mal uso.
  const dia = top(sinUso, (r) => r.fecha_activacion);
  if (dia && sinUso.length >= 3 && dia[1] / sinUso.length >= 0.5) {
    senales.push({ gravedad: "media", texto: `${dia[1]} de ${sinUso.length} sin uso activadas el ${fechaCorta(dia[0])}` });
  }
  const diaTotal = top(pospago, (r) => r.fecha_activacion);
  if (diaTotal && pospago.length >= 6 && diaTotal[1] / pospago.length >= 0.4) {
    senales.push({ gravedad: "media", texto: `${pctDe(diaTotal[1], pospago.length)}% de sus Pospago en un solo día (${fechaCorta(diaTotal[0])})` });
  }

  // Concentración en plan / origen de portación.
  const plan = top(sinUso, (r) => r.plan);
  if (plan && sinUso.length >= 3 && plan[1] / sinUso.length >= 0.7) {
    senales.push({ gravedad: "media", texto: `Sin uso concentradas en ${plan[0]} (${plan[1]} de ${sinUso.length})` });
  }
  const origen = top(sinUso, (r) => (r.portacion === "SI" ? `portación ${r.origen_portacion ?? ""}`.trim() : "nativa"));
  if (origen && sinUso.length >= 3 && origen[1] / sinUso.length >= 0.7) {
    senales.push({ gravedad: "info", texto: `Sin uso casi todas de ${origen[0]} (${origen[1]} de ${sinUso.length})` });
  }
  const nativasSinUso = sinUso.filter((r) => r.portacion !== "SI").length;
  const nativas = pospago.filter((r) => r.portacion !== "SI" && estadoUso(r, corte) !== "ESPERA").length;
  if (nativas >= 3 && nativasSinUso / nativas >= 0.6) {
    senales.push({ gravedad: "media", texto: `Nativas sin uso: ${nativasSinUso} de ${nativas}` });
  }

  // Ciudad: ventas sin uso concentradas en una ciudad (posible captación dudosa).
  const ciudad = top(sinUso, (r) => r.ciudad);
  if (ciudad && sinUso.length >= 4 && ciudad[1] / sinUso.length >= 0.75) {
    senales.push({ gravedad: "info", texto: `Sin uso concentradas en ${ciudad[0]} (${ciudad[1]} de ${sinUso.length})` });
  }

  if (v.suspendidas) senales.push({ gravedad: v.suspendidas >= 2 ? "alta" : "media", texto: `${v.suspendidas} línea${v.suspendidas > 1 ? "s" : ""} suspendida${v.suspendidas > 1 ? "s" : ""} al cierre` });
  const fuera = d.fuera_de_netas.detalle.filter((r) => r.vendedor === v.vendedor).length;
  if (fuera) senales.push({ gravedad: fuera >= 3 ? "media" : "info", texto: `${fuera} ${fuera > 1 ? "portaciones que no llegaron" : "portación que no llegó"} a DDI` });

  const puntaje =
    sinUsoAntiguas * 3 +
    v.suspendidas * 2 +
    (v.alerta ? 5 : 0) +
    senales.filter((s) => s.gravedad === "alta").length * 2;

  return { senales, sinUsoAntiguas, enEspera, puntaje };
}

/** Vendedores críticos: en alerta (umbral), con 3+ sin uso antiguas o con 2+ suspendidas. Ordenados por puntaje. */
export function vendedoresCriticos(d: InformeData) {
  const porVendedor = new Map<string, DetalleNeta[]>();
  for (const r of d.detalle_netas) porVendedor.set(r.vendedor, [...(porVendedor.get(r.vendedor) ?? []), r]);
  return d.vendedores
    .map((v) => ({ v, patron: patronVendedor(d, v, porVendedor.get(v.vendedor) ?? []) }))
    .filter(({ v, patron }) => v.alerta || patron.sinUsoAntiguas >= 3 || v.suspendidas >= 2)
    .sort((a, b) => b.patron.puntaje - a.patron.puntaje);
}
