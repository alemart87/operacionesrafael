"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PrintButton, PrintCover } from "@/components/PrintButton";
import { Bloque } from "@/components/facturacion/Bloque";
import { Cascada, PasoCascada, ZonaCascada } from "@/components/facturacion/Cascada";
import { ObservacionConceptosEERR, ObservacionRecupero } from "@/components/facturacion/ConceptosLiquidacion";
import { EstructuraOperativa } from "@/components/facturacion/EstructuraOperativa";
import { apiFetch } from "@/lib/api";
import { formatGs, formatInt } from "@/lib/format";

/** Criterios de liquidación · página FIJA para el directorio.
 *  Escenario: 2.000 líneas, 19 líneas por vendedor, comisión y plus vigentes, resto del modelo como está.
 *  Tres momentos críticos de la facturación de UNA cohorte: mes 1, 6 meses, cierre del residual (12 meses). */
const ESCENARIO = { ventas: 2000, ventas_por_vendedor: 19 };

const M = (v: number) => `${v < 0 ? "−" : ""}${Math.round(Math.abs(v) / 1e6)} M`;
const pct = (v: number, base: number) => (base ? `${Math.round((v / base) * 1000) / 10}%` : "—");

function Cifra({ label, valor, tono = "ink", sub }: { label: string; valor: string; tono?: "ink" | "primary" | "ok" | "orange" | "cyan"; sub?: string }) {
  const cls = { ink: "text-brand-ink", primary: "text-brand-primary", ok: "text-emerald-600", orange: "text-brand-orange", cyan: "text-brand-cyan" }[tono];
  return (
    <div className="rounded-md border border-brand-border bg-white px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider2 text-brand-slate font-bold">{label}</div>
      <div className={`font-display text-2xl leading-tight ${cls}`}>{valor}</div>
      {sub && <div className="text-[10px] text-brand-slate">{sub}</div>}
    </div>
  );
}

function Momento({ n, titulo, cuando, color, headline, headlineTono, children }: {
  n: number; titulo: string; cuando: string; color: string; headline: string; headlineTono: "ink" | "primary" | "ok"; children: React.ReactNode;
}) {
  const hl = { ink: "text-brand-ink", primary: "text-brand-primary", ok: "text-emerald-600" }[headlineTono];
  return (
    <section className="card p-0 overflow-hidden print:break-inside-avoid">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3" style={{ background: color }}>
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-full bg-white/20 text-white font-display text-xl flex items-center justify-center">{n}</span>
          <div>
            <div className="text-[10px] uppercase tracking-wider2 text-white/70 font-bold">Momento {n} · {cuando}</div>
            <h2 className="font-display text-lg text-white uppercase leading-tight">{titulo}</h2>
          </div>
        </div>
        <div className={`font-display text-2xl md:text-3xl bg-white rounded-md px-3 py-1 ${hl}`}>{headline}</div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export default function CriteriosLiquidacionPage() {
  const [p, setP] = useState<any>(null);
  const [res, setRes] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<any>("/api/v1/televentas-claro/facturacion/simulador/parametros").then((d) => {
      const params = { ...d.parametros, ventas: ESCENARIO.ventas, costos: { ...d.parametros.costos, ventas_por_vendedor: ESCENARIO.ventas_por_vendedor } };
      setP(params);
      return apiFetch<any>("/api/v1/televentas-claro/facturacion/simulador", { method: "POST", body: JSON.stringify({ parametros: params }) });
    }).then((r) => setRes(r)).catch((e) => setError(e.message));
  }, []);

  const meses: any[] = res?.meses ?? [];
  const sum = (k: string, desde: number, hasta: number) => meses.slice(desde, hasta + 1).reduce((s, m) => s + (m[k] ?? 0), 0);
  const mes0 = res?.mes0 ?? {};
  const bruta = res?.bruto_mes0 ?? 0;
  const costos = res?.costos?.total ?? 0;
  const margenInicial = bruta - costos;
  // Ola potencial del chargeback: todo lo que la cohorte va a devolver (legajos, caídas, bonos, recálculo) hasta el mes 6.
  const olaLegajos = sum("legajos", 1, 6), olaCaidas = sum("clawbacks", 1, 6), olaBonoEf = sum("clawback_bonos", 1, 6), olaRecalc = sum("recalculo_productividad", 1, 6);
  const ola = olaLegajos + olaCaidas + olaBonoEf + olaRecalc;
  const cobros6 = sum("residual", 1, 6) + sum("cuota2", 1, 6);
  const neto6 = res?.neto_6 ?? 0, neto12 = res?.neto_12 ?? 0;
  const margen6 = neto6 - costos, margen12 = neto12 - costos;
  const residual12 = sum("residual", 1, 12), cuota2 = sum("cuota2", 1, 12), residual7a12 = sum("residual", 7, 12);
  const devBonos = olaBonoEf + olaRecalc;

  const descubierto = margenInicial + ola;   // margen inicial − ola: lo que el mes 1 NO alcanza a cubrir si Claro descuenta toda la ola
  const cobros12 = cuota2 + residual12;
  const pasos1: PasoCascada[] = [
    { nombre: "Cuota 1", corto: "+ Cuota 1", valor: mes0.activaciones_cuota1 ?? 0, color: "#0F1116" },
    { nombre: "Plus portabilidad", corto: "+ Porta", valor: mes0.portabilidad ?? 0, color: "#0EA5E9" },
    { nombre: "Bono productividad", corto: "+ Bono prod.", valor: mes0.bono_productividad ?? 0, color: "#E6332A" },
    { nombre: "Bono efectividad", corto: "+ Bono efect.", valor: mes0.bono_efectividad ?? 0, color: "#F39200" },
    { nombre: "= Facturación del mes 1", corto: "= Facturado", valor: bruta, tipo: "total" },
    { nombre: "− Costos de la estructura del mes", corto: "− Costos", valor: -costos },
    { nombre: "= Margen inicial (facturado − costos)", corto: "= Margen inicial", valor: margenInicial, tipo: "total", color: margenInicial >= 0 ? "#10B981" : "#E6332A" },
    { nombre: "− Ola potencial: lo que Claro puede descontar en 180 días (legajos, caídas, bonos, recálculo)", corto: "− Ola potencial", valor: ola, color: "#E6332A" },
    { nombre: "= Descubierto (margen inicial − ola): lo que el mes 1 no alcanza a cubrir", corto: "= Descubierto", valor: descubierto, tipo: "total", color: descubierto >= 0 ? "#10B981" : "#B91C1C" },
  ];
  const pasos2: PasoCascada[] = [
    { nombre: "= Facturación del mes 1", corto: "= Facturado", valor: bruta, tipo: "total" },
    { nombre: "+ Cuota 2 y residual cobrados en 6 meses", corto: "+ Cobrado", valor: cobros6, color: "#10B981" },
    { nombre: "− Legajos", corto: "− Legajos", valor: olaLegajos },
    { nombre: "− Caídas (cuota 1, porta, residual)", corto: "− Caídas", valor: olaCaidas },
    { nombre: "− Devolución bono efectividad", corto: "− Bono efect.", valor: olaBonoEf },
    { nombre: "− Recálculo bono productividad (día 180)", corto: "− Recálculo", valor: olaRecalc },
    { nombre: "= Neto liquidado a 6 meses", corto: "= Neto 6 m", valor: neto6, tipo: "total" },
    { nombre: "− Costos de la estructura del mes", corto: "− Costos", valor: -costos },
    { nombre: "= Margen a 6 meses (neto − costos)", corto: "= Margen 6 m", valor: margen6, tipo: "total", color: margen6 >= 0 ? "#10B981" : "#B91C1C" },
  ];
  const pasos3: PasoCascada[] = [
    { nombre: "= Facturación del mes 1", corto: "= Facturado", valor: bruta, tipo: "total" },
    { nombre: "+ Cuota 2", corto: "+ Cuota 2", valor: cuota2, color: "#10B981" },
    { nombre: "+ Residual de 12 meses", corto: "+ Residual", valor: residual12, color: "#0EA5E9" },
    { nombre: "− Legajos", corto: "− Legajos", valor: olaLegajos },
    { nombre: "− Caídas (cuota 1, porta, residual)", corto: "− Caídas", valor: olaCaidas },
    { nombre: "− Bonos devueltos (efectividad + recálculo)", corto: "− Bonos dev.", valor: devBonos },
    { nombre: "= Facturado real (neto a 12 meses)", corto: "= Facturado real", valor: neto12, tipo: "total" },
    { nombre: "− Costos de la estructura del mes", corto: "− Costos", valor: -costos },
    { nombre: "= Margen real (facturado real − costos)", corto: "= Margen real", valor: margen12, tipo: "total", color: margen12 >= 0 ? "#10B981" : "#B91C1C" },
  ];

  const Z = { factura: "#0EA5E9", eerr: "#4B5563", riesgo: "#E6332A", ajustes: "#F39200", cierre: "#00B2BF" };
  const zonas1: ZonaCascada[] = [
    { nombre: "1 · Lo que Claro paga en el mes 1", desde: 0, hasta: 4, color: Z.factura, descripcion: "Cuota 1, plus porta y los dos bonos se cobran completos en la liquidación del mes." },
    { nombre: "2 · EERR del mes 1", desde: 5, hasta: 6, color: Z.eerr, descripcion: "Facturado menos la estructura del mes = margen inicial. Es el número que se ve en la primera liquidación." },
    { nombre: "3 · Potencial de devolución", desde: 7, hasta: 8, color: Z.riesgo, descripcion: "Una sola resta: al margen inicial se le descuenta la ola (lo que Claro puede devolver en 180 días). El resultado es el descubierto: lo que el mes 1 no cubre." },
  ];
  const zonas2: ZonaCascada[] = [
    { nombre: "1 · Facturado", desde: 0, hasta: 0, color: Z.factura, descripcion: "Punto de partida: la liquidación del mes 1." },
    { nombre: "2 · Lo que pasó en 6 meses", desde: 1, hasta: 6, color: Z.ajustes, descripcion: "Se cobra cuota 2 y residual; se devuelven legajos, caídas, bono efectividad y el recálculo del bono al día 180." },
    { nombre: "3 · EERR a 6 meses", desde: 7, hasta: 8, color: Z.eerr, descripcion: "Neto a 6 meses menos la estructura = margen a 6 meses, con el riesgo ya cerrado." },
  ];
  const zonas3: ZonaCascada[] = [
    { nombre: "1 · Facturado", desde: 0, hasta: 0, color: Z.factura, descripcion: "Lo que se facturó en el mes 1." },
    { nombre: "2 · Ajustes de los 12 meses", desde: 1, hasta: 6, color: Z.ajustes, descripcion: "Todo lo que se cobró después (cuota 2, residual) y todo lo que se devolvió (legajos, caídas, bonos) = facturado real." },
    { nombre: "3 · EERR real", desde: 7, hasta: 8, color: Z.cierre, descripcion: "Facturado real menos la estructura = margen real de la cohorte. Este es el número final." },
  ];
  const hc = res?.costos?.headcount;

  return (
    <AppShell>
      <PrintCover titulo="Criterios de liquidación · Televentas CLARO" periodo={`Escenario fijo: ${formatInt(ESCENARIO.ventas)} líneas · ${ESCENARIO.ventas_por_vendedor} por vendedor`} />
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider2 font-bold text-brand-slate">Televentas CLARO · Facturación</div>
            <h1 className="font-display text-3xl text-brand-ink uppercase">Criterios de liquidación</h1>
            <p className="text-sm text-brand-graphite mt-1 max-w-3xl">
              Tres momentos críticos de la facturación de una cohorte. Escenario fijo del directorio: <b>{formatInt(ESCENARIO.ventas)} líneas</b> en el mes,{" "}
              <b>{ESCENARIO.ventas_por_vendedor} líneas por vendedor</b>, comisión y plus vigentes por venta, y el resto del modelo como está calibrado con las liquidaciones reales.
              {hc && <> Estructura: {hc.vendedores} vendedores, {hc.supervisores} supervisores, {hc.backoffice} backoffice, {hc.total} personas.</>}
            </p>
          </div>
          <PrintButton />
        </div>

        {error && <div className="card p-4 text-sm text-brand-primary">{error}</div>}
        {!res && !error && <div className="card p-6 text-sm text-brand-slate">Calculando el escenario…</div>}

        {res && (
          <>
            <Momento n={1} cuando="Mes 1" titulo="Facturación con la ola potencial del chargeback" color="#0F1116"
              headline={`Margen inicial ${M(margenInicial)} · ${pct(margenInicial, bruta)}`} headlineTono={margenInicial >= 0 ? "ok" : "primary"}>
              <Cascada pasos={pasos1} zonas={zonas1} altura={340} />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                <Cifra label="Se factura en el mes 1" valor={M(bruta)} sub={`${formatInt(ESCENARIO.ventas)} líneas`} />
                <Cifra label="Margen inicial" valor={M(margenInicial)} tono={margenInicial >= 0 ? "ok" : "primary"} sub={`${pct(margenInicial, bruta)} de lo facturado`} />
                <Cifra label="Ola potencial (180 días)" valor={M(ola)} tono="primary" sub={`${pct(-ola, bruta)} de lo facturado puede volver a Claro`} />
                <Cifra label="Descubierto = margen − ola" valor={M(descubierto)} tono={descubierto >= 0 ? "ok" : "primary"} sub={`${M(margenInicial)} de margen no cubren ${M(-ola)} de ola`} />
              </div>
              <div className="mt-3 rounded-md border border-brand-border bg-brand-bg-soft px-4 py-3 text-[12px] text-brand-graphite space-y-1">
                <div><b className="text-brand-ink">Cómo leerlo.</b> Las barras con <b>+</b> suman, las de <b>−</b> restan y las de <b>=</b> son resultados. La ola no es un costo más: es <b>una sola resta</b> sobre el margen inicial.</div>
                <div className="font-mono text-brand-ink">{M(bruta)} facturado − {M(costos)} costos = <b>{M(margenInicial)}</b> margen inicial → {M(margenInicial)} − {M(-ola)} ola = <b className="text-brand-primary">{M(descubierto)}</b> descubierto</div>
                <div>El mes 1 cobra todo y todavía no devuelve nada. El margen inicial parece ganado, pero {pct(-ola, bruta)} de lo facturado puede volver a Claro en 180 días y el margen del mes solo cubre el {pct(margenInicial, -ola)} de esa ola. Lo que la tapa después son los cobros posteriores (cuota 2 y residual, {M(cobros12)} en 12 meses): por eso el cierre real es {M(margen12)} y no {M(descubierto)}.</div>
              </div>
            </Momento>

            <Momento n={2} cuando="6 meses" titulo="Ya cayó el chargeback del bono" color="#F39200"
              headline={`Margen a 6 meses ${M(margen6)} · ${pct(margen6, neto6)}`} headlineTono={margen6 >= 0 ? "ok" : "primary"}>
              <Cascada pasos={pasos2} zonas={zonas2} altura={340} />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                <Cifra label="Devuelto en 6 meses" valor={M(ola)} tono="primary" sub={`legajos ${M(olaLegajos)} · caídas ${M(olaCaidas)} · bonos ${M(devBonos)}`} />
                <Cifra label="Cobrado en 6 meses" valor={M(cobros6)} tono="ok" sub="cuota 2 al día 90 + residual" />
                <Cifra label="Queda neto a 6 meses" valor={M(neto6)} sub={`${res.pct_retenido_6}% de lo facturado`} />
                <Cifra label="Riesgo pendiente" valor="0" tono="ok" sub={`sin devoluciones después del día 184 · por cobrar ${M(residual7a12)} de residual`} />
              </div>
              <div className="mt-3 rounded-md border border-brand-border bg-brand-bg-soft px-4 py-3 text-[12px] text-brand-graphite space-y-1">
                <div className="font-mono text-brand-ink">{M(bruta)} facturado + {M(cobros6)} cobrado − {M(-ola)} devuelto = <b>{M(neto6)}</b> neto a 6 meses → {M(neto6)} − {M(costos)} costos = <b className={margen6 >= 0 ? "text-emerald-600" : "text-brand-primary"}>{M(margen6)}</b> margen a 6 meses</div>
                <div><b className="text-brand-ink">Lectura.</b> Al día 180 Claro recalcula el bono productividad y devuelve el 100% del bono de cada línea caída. Acá se cierra el riesgo: no hay más devoluciones y de acá en más solo entra residual.</div>
              </div>
            </Momento>

            <Momento n={3} cuando="Cierre del residual · 12 meses" titulo="Margen final con sus componentes" color="#0EA5E9"
              headline={`Margen real ${M(margen12)} · ${pct(margen12, neto12)}`} headlineTono={margen12 >= 0 ? "ok" : "primary"}>
              <Cascada pasos={pasos3} zonas={zonas3} altura={340} />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                <Cifra label="Se facturó" valor={M(bruta)} sub="mes 1, bruto" />
                <Cifra label="Facturado real" valor={M(neto12)} tono="cyan" sub={`${res.pct_retenido_12}% de lo facturado quedó`} />
                <Cifra label="Costos" valor={M(costos)} tono="orange" sub={`${formatGs(res.costos.costo_por_venta)} por línea`} />
                <Cifra label="Margen real" valor={M(margen12)} tono={margen12 >= 0 ? "ok" : "primary"} sub={`${pct(margen12, neto12)} sobre el facturado real · ${pct(margen12, bruta)} sobre lo facturado`} />
              </div>
              <div className="mt-3 rounded-md border border-brand-border bg-brand-bg-soft px-4 py-3 text-[12px] text-brand-graphite space-y-1">
                <div className="font-mono text-brand-ink">{M(bruta)} facturado + {M(cobros12)} cobrado − {M(-ola)} devuelto = <b>{M(neto12)}</b> facturado real → {M(neto12)} − {M(costos)} costos = <b className={margen12 >= 0 ? "text-emerald-600" : "text-brand-primary"}>{M(margen12)}</b> margen real</div>
                <div><b className="text-brand-ink">Lectura.</b> Cerrado el residual, esto es lo que la cohorte dejó de verdad: {formatGs(neto12)} de {formatGs(bruta)} facturados ({res.pct_retenido_12}%), contra {formatGs(costos)} de estructura.</div>
              </div>
            </Momento>

            <Bloque titulo="Estructura necesaria e indicadores" hint={hc ? `${hc.vendedores} vendedores · ${hc.total} personas · costo ${formatGs(res.costos.total)}/mes` : undefined}>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                <Cifra label="Facturación por línea" valor={formatGs(Math.round(bruta / ESCENARIO.ventas))} sub="mes 1" />
                <Cifra label="Queda por línea a 12 meses" valor={formatGs(Math.round(neto12 / ESCENARIO.ventas))} tono="cyan" sub={`${res.pct_retenido_12}%`} />
                <Cifra label="Costo por línea" valor={formatGs(res.costos.costo_por_venta)} tono="orange" />
                <Cifra label="Margen por línea" valor={formatGs(Math.round(margen12 / ESCENARIO.ventas))} tono={margen12 >= 0 ? "ok" : "primary"} sub="real, a 12 meses" />
              </div>
              <EstructuraOperativa costos={res.costos} p={p} ventas={ESCENARIO.ventas} sinCard />
            </Bloque>

            <Bloque titulo="Conceptos de Claro y de la liquidación" hint="reglas, escalas y conceptos que alimentan cada fila">
              <div className="grid md:grid-cols-2 gap-3 mb-3 text-[12px] text-brand-graphite">
                <div className="rounded-md border border-brand-border bg-white p-3 space-y-1">
                  <div className="text-[10px] uppercase tracking-wider2 text-brand-slate font-bold">Reglas de liquidación</div>
                  <div><b className="text-brand-ink">Cuota 1</b> por activación según plan; <b className="text-brand-ink">cuota 2</b> al día 90 con legajo completo (incompleto cobra la mitad).</div>
                  <div><b className="text-brand-ink">Plus portabilidad</b> en las líneas portadas ({p?.porta_pct}% de las activaciones).</div>
                  <div><b className="text-brand-ink">Chargeback</b> de {p?.chargeback_meses} meses: cada caída devuelve cuota 1 (en el {p?.pct_caidas_penalizables}% de los casos), porta y bono efectividad; recupero por reconexión {p?.recupero_pct}%.</div>
                  <div><b className="text-brand-ink">Recálculo del bono productividad</b> al día 180: 100% del bono de cada línea caída ({res.derivados?.pct_recalculo_efectivo}% de las líneas según la zafra).</div>
                  <div><b className="text-brand-ink">Residual</b> {p?.residual_pct}% del abono acreditado durante {p?.residual_meses} meses, sobre las líneas que pagan.</div>
                  <div><b className="text-brand-ink">PFI</b> (primera factura impaga): suspensión penalizable a los ~60 días, la mayor caída de la zafra.</div>
                </div>
                <div className="rounded-md border border-brand-border bg-white p-3 space-y-2">
                  <div className="text-[10px] uppercase tracking-wider2 text-brand-slate font-bold">Escalas de bonos</div>
                  <table className="w-full text-[11px]">
                    <thead><tr className="text-[9px] uppercase text-brand-slate"><th className="text-left">Bono productividad (objetivo CO)</th><th className="text-right">Gs por línea</th></tr></thead>
                    <tbody>{(p?.escala_productividad ?? []).map((e: any) => <tr key={e.desde_pct} className="border-t border-brand-border"><td>≥ {e.desde_pct}% del objetivo</td><td className="text-right font-mono">{formatGs(e.monto)}</td></tr>)}</tbody>
                  </table>
                  <table className="w-full text-[11px]">
                    <thead><tr className="text-[9px] uppercase text-brand-slate"><th className="text-left">Bono efectividad (entregas)</th><th className="text-right">Gs por venta</th></tr></thead>
                    <tbody>{(p?.escala_efectividad ?? []).map((e: any) => <tr key={e.desde_pct} className="border-t border-brand-border"><td>≥ {e.desde_pct}% de efectividad</td><td className="text-right font-mono">{formatGs(e.monto)}</td></tr>)}</tbody>
                  </table>
                </div>
              </div>
              <ObservacionConceptosEERR />
              <div className="mt-3"><ObservacionRecupero /></div>
            </Bloque>
          </>
        )}
      </div>
    </AppShell>
  );
}
