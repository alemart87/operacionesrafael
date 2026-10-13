"use client";

/** Ficha impresa de la simulación: todos los datos con los que se simuló (ventas por mes, zafra, tarifas de Claro
 *  —upfront, cuota 2, plus porta—, bonos y reglas de liquidación, chargeback, residual, costos de la estructura, GPON,
 *  meses afectados y notas). Solo se ve al imprimir. Marca con ✱ lo que difiere de los valores calibrados con las
 *  liquidaciones reales, así quien lee el PDF sabe si mira la realidad o un objetivo. */
import { formatGs, formatInt } from "@/lib/format";
import { ZAFRA_IDEAL } from "./presets";

type Props = {
  negocio: "movil" | "gpon";
  p: any; defaults: any;
  pg?: any | null; pgDefaults?: any | null; gponOn?: boolean; gponAsesor?: number[]; gponObjetivoAuto?: boolean;
  horizonte: number; ventas: number[]; nombres: string[]; bonosAd: number[];
  afectados: Record<string, any>;
  actual?: any | null; notas?: any[];
  res?: any | null;
};

const pct = (v: any, d = 1) => (v == null || v === "" ? "—" : `${Number(v).toLocaleString("es-PY", { minimumFractionDigits: 0, maximumFractionDigits: d })} %`);
const num = (v: any, d = 0) => (v == null || v === "" ? "—" : Number(v).toLocaleString("es-PY", { minimumFractionDigits: 0, maximumFractionDigits: d }));
const gs = (v: any) => (v == null || v === "" ? "—" : formatGs(Number(v)));
const siNo = (v: any) => (v === false ? "No" : "Sí");

const dif = (a: any, b: any): boolean => {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
  if (typeof a === "object" && a && typeof b === "object" && b) return JSON.stringify(a) !== JSON.stringify(b);
  if (typeof a === "boolean" || typeof b === "boolean" || a == null || b == null) return (a ?? null) !== (b ?? null);
  return Math.abs(Number(a) - Number(b)) > 1e-9;
};

/** Una fila "etiqueta · valor" con la marca ✱ si difiere del calibrado. */
function Dato({ label, value, base, hint }: { label: string; value: string; base?: any; hint?: string }) {
  return (
    <tr>
      <td className="fi-k">{label}{hint ? <span className="fi-hint"> · {hint}</span> : null}</td>
      <td className="fi-v">{value}{base === true ? <span className="fi-mod" title="Distinto del valor calibrado">✱</span> : null}</td>
    </tr>
  );
}

const escalaTxt = (e: any[]) => (e || []).slice().sort((a, b) => Number(b.desde_pct) - Number(a.desde_pct))
  .map((x) => `≥${num(x.desde_pct)} % → ${gs(x.monto)}`).join(" · ") || "—";

// Etiquetas de las variaciones de un mes afectado (pospago y GPON) y de los costos.
const LABEL: Record<string, string> = {
  porta_pct: "Portabilidad", efectividad_pct: "Efectividad de entregas", pct_bono_efectividad_cobrado: "Activaciones que cobran bono efectividad",
  objetivo_co: "Objetivo CO", pct_estado_a: "Líneas en estado A", ajuste_comisiones_pct: "Ajuste de comisiones", bonos_activos: "Bonos activos",
  legajo_incompleto_pct: "Legajos incompletos", legajo_no_presentado_pct: "Legajos no presentados", pct_caidas_penalizables: "Caídas penalizables",
  recupero_pct: "Recupero por reconexión", pct_bajas_gross: "Caídas que terminan en baja (Gross)", pct_recalculo_productividad: "Líneas castigadas en el recálculo",
  migracion_negocio_pct: "Migración de negocio", comision_por_venta: "Comisión al vendedor por venta", plus_por_venta: "Plus al vendedor por venta",
  logistica_interior_pct: "Entregas en Interior", operativo_por_venta: "Costo operativo por venta",
  objetivo: "Objetivo de líneas", pct_bono_cobrado: "Activaciones que cobran el bono", cuota2_pct_lineas: "Líneas que cobran cuota 2",
  cuota2_pct_completa: "Cuota 2 completa", legajo_pct: "Legajos incompletos (50 %)", mora_pct_lineas: "Líneas en mora",
  mora_penalidad_pct: "Penalidad de mora que se pierde", pct_recalculo: "Líneas castigadas en el recálculo",
  ventas_por_vendedor: "Ventas por vendedor", supervisor_cada_vendedores: "Vendedores por supervisor", backoffice_cada_ventas: "Ventas por backoffice",
  coordinadores: "Coordinadores", controllers: "Controllers", salario_hora: "Salario por hora (operador)", horas_dia: "Horas por día", dias_mes: "Días por mes",
  supervisor_salario: "Supervisor · salario", supervisor_premio: "Supervisor · premio", coordinador_salario: "Coordinador · salario",
  coordinador_premio: "Coordinador · premio", backoffice_salario: "Backoffice · salario", controller_salario: "Controller · salario",
  controller_premio: "Controller · premio", subgerencia_salario: "SubGerencia Comercial", ips_pct: "IPS", aguinaldo: "Previsión de aguinaldo",
  logistica_central: "Entrega en Central", logistica_interior: "Entrega en Interior", logistica_premios: "Cobertura adicional interior",
  documentacion_por_venta: "Recupero de documentación por venta",
};
const PCT_KEYS = new Set(["porta_pct", "efectividad_pct", "pct_bono_efectividad_cobrado", "pct_estado_a", "ajuste_comisiones_pct", "legajo_incompleto_pct",
  "legajo_no_presentado_pct", "pct_caidas_penalizables", "recupero_pct", "pct_bajas_gross", "pct_recalculo_productividad", "migracion_negocio_pct",
  "pct_bono_cobrado", "cuota2_pct_lineas", "cuota2_pct_completa", "legajo_pct", "mora_pct_lineas", "mora_penalidad_pct", "pct_recalculo",
  "logistica_interior_pct", "ips_pct"]);
const GS_KEYS = new Set(["comision_por_venta", "plus_por_venta", "operativo_por_venta", "salario_hora", "supervisor_salario", "supervisor_premio",
  "coordinador_salario", "coordinador_premio", "backoffice_salario", "controller_salario", "controller_premio", "subgerencia_salario",
  "logistica_central", "logistica_interior", "logistica_premios", "documentacion_por_venta"]);
const fmtCampo = (k: string, v: any) => (typeof v === "boolean" ? siNo(v) : v == null ? "según zafra" : PCT_KEYS.has(k) ? pct(v) : GS_KEYS.has(k) ? gs(v) : num(v, 2));

export function FichaSimulacion({ negocio, p, defaults, pg, pgDefaults, gponOn, gponAsesor = [], gponObjetivoAuto = true, horizonte, ventas, nombres, bonosAd, afectados, actual, notas = [], res }: Props) {
  if (!p) return null;
  const d = defaults || {};
  const c = p.costos || {}, dc = d.costos || {};
  const esMovil = negocio === "movil";
  const zafra: number[] = (p.zafra_pct || []).map(Number);
  const zafraReal: number[] = (d.zafra_pct || []).map(Number);
  const zafraIdeal = zafra.length && zafra.every((z, i) => Math.abs(z - (ZAFRA_IDEAL[i] ?? -1)) < 1e-9);
  const zafraCalibrada = zafra.length && zafra.every((z, i) => Math.abs(z - (zafraReal[i] ?? -1)) < 1e-9);
  const fueraBanda = zafra.map((z, i) => ({ i, z, ideal: ZAFRA_IDEAL[i] })).filter((x) => x.ideal != null && x.z < x.ideal - 3.5);
  const planes: any[] = p.planes || [];
  const mixTotal = planes.reduce((s, x) => s + Number(x.mix_pct || 0), 0) || 1;
  const pond = (k: string) => planes.reduce((s, x) => s + Number(x[k] || 0) * Number(x.mix_pct || 0), 0) / mixTotal;
  const planBase = (nombre: string) => (d.planes || []).find((x: any) => (x.plan ?? x.nombre) === nombre) || {};
  const nombreMes = (i: number) => (nombres[i] || "").trim() || `Mes ${i + 1}`;
  const vendedores = c.ventas_por_vendedor > 0 ? Math.ceil(Number(ventas[0] ?? p.ventas ?? 0) / Number(c.ventas_por_vendedor)) : 0;
  const a = res?.anual;
  const escenario = [
    esMovil && p.bono_unico ? "Bono único (propuesta 2027)" : null,
    esMovil && Number(p.ajuste_comisiones_pct) ? `Ajuste de comisiones ${Number(p.ajuste_comisiones_pct) > 0 ? "+" : ""}${num(p.ajuste_comisiones_pct, 1)} %` : null,
    esMovil && p.devolver_bono_productividad === false ? "Sin descuento de Claro sobre el bono productividad" : null,
    esMovil && p.devolver_bono_efectividad === false ? "Sin descuento de Claro sobre el bono logística" : null,
    p.bonos_activos === false ? "Sin bonos" : null,
    esMovil ? (gponOn ? `Convergente: GPON por la misma estructura (${num(gponAsesor[0] ?? 3, 2)} por asesor en el mes 1)` : "Solo pospago (GPON excluido)") : null,
  ].filter(Boolean) as string[];
  const fecha = new Date().toLocaleDateString("es-PY", { day: "2-digit", month: "long", year: "numeric" });
  const costosKeys = Object.keys(c).filter((k) => LABEL[k]);
  const afectadosLista = Object.entries(afectados || {}).map(([m, ov]) => ({ mes: Number(m), ov: ov as any })).sort((x, y) => x.mes - y.mes);

  return (
    <section className="print-only ficha-impresa">
      <div className="fi-head">
        <div>
          <div className="fi-kicker">Datos de la simulación</div>
          <h2 className="fi-title">{actual?.nombre || "Simulación sin guardar"}</h2>
          {actual?.comentario && <p className="fi-comentario">{actual.comentario}</p>}
        </div>
        <div className="fi-meta">
          <div><b>Negocio:</b> {esMovil ? (gponOn ? "Convergente (pospago + GPON)" : "Pospago móvil") : "GPON (fibra)"}</div>
          <div><b>Horizonte:</b> {horizonte} meses · <b>Mes 1:</b> {nombreMes(0)}</div>
          {actual ? <div><b>Guardada por:</b> {actual.created_by_nombre || "—"} el {new Date(actual.created_at).toLocaleDateString("es-PY")}{actual.updated_at ? ` · editada ${new Date(actual.updated_at).toLocaleDateString("es-PY")}` : ""}</div> : null}
          <div><b>Impresa:</b> {fecha}</div>
          <div className="fi-leyenda"><span className="fi-mod">✱</span> distinto del valor calibrado con las liquidaciones reales</div>
        </div>
      </div>

      {escenario.length > 0 && (
        <div className="fi-escenario">
          <div className="fi-kicker">Escenario</div>
          <ul>{escenario.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}

      {/* ===== Ventas por mes ===== */}
      <div className="fi-grid">
        <div className="fi-block fi-span2">
          <h3>Ventas por mes</h3>
          <table className="fi-tabla fi-meses">
            <thead>
              <tr><th>Mes</th>{ventas.map((_, i) => <th key={i}>{i + 1}</th>)}</tr>
            </thead>
            <tbody>
              <tr><td>Nombre</td>{ventas.map((_, i) => <td key={i} className="fi-nombre">{nombreMes(i)}</td>)}</tr>
              <tr><td>{esMovil ? "Ventas pospago" : "Activaciones"}</td>{ventas.map((v, i) => <td key={i}><b>{num(v)}</b></td>)}</tr>
              {esMovil && gponOn && <tr><td>GPON por asesor</td>{ventas.map((_, i) => <td key={i}>{num(gponAsesor[i] ?? gponAsesor[0] ?? 3, 2)}</td>)}</tr>}
              {esMovil && gponOn && <tr><td>Activaciones GPON</td>{ventas.map((_, i) => <td key={i}>{num(res?.ventas_gpon_por_mes?.[i] ?? Math.round(vendedores * (gponAsesor[i] ?? gponAsesor[0] ?? 3)))}</td>)}</tr>}
              {bonosAd.some((b) => Number(b) > 0) && <tr><td>Bono adicional (Gs)</td>{ventas.map((_, i) => <td key={i}>{Number(bonosAd[i]) > 0 ? num(bonosAd[i]) : "—"}</td>)}</tr>}
              {afectadosLista.length > 0 && <tr><td>Mes afectado</td>{ventas.map((_, i) => <td key={i}>{afectados?.[String(i + 1)] ? "✎" : ""}</td>)}</tr>}
            </tbody>
          </table>
          <p className="fi-nota">El mes 1 dimensiona la estructura, que queda fija: <b>{num(vendedores)}</b> vendedores con {num(c.ventas_por_vendedor)} ventas por vendedor
            {a ? <>, {num(a.horizonte ? res?.headcount?.supervisores : "")} supervisores y {num(res?.headcount?.backoffice)} backoffice; costo fijo {gs(a.costos_fijos_mes)} por mes</> : null}.</p>
        </div>

        {/* ===== Zafra ===== */}
        {esMovil && (
          <div className="fi-block fi-span2">
            <h3>Zafra (líneas activas por mes de antigüedad){zafraIdeal ? " · IDEAL" : zafraCalibrada ? " · real calibrada" : <> · modificada <span className="fi-mod">✱</span></>}</h3>
            <table className="fi-tabla fi-zafra">
              <thead><tr><th></th>{zafra.map((_, i) => <th key={i}>M{i}</th>)}</tr></thead>
              <tbody>
                <tr><td><b>Cargada</b></td>{zafra.map((z, i) => <td key={i} className={fueraBanda.some((f) => f.i === i) ? "fi-bad" : ""}><b>{num(z, 1)}</b></td>)}</tr>
                <tr><td>Ideal (dirección)</td>{zafra.map((_, i) => <td key={i}>{num(ZAFRA_IDEAL[i], 1)}</td>)}</tr>
                <tr><td>Real (liquidaciones)</td>{zafra.map((_, i) => <td key={i}>{num(zafraReal[i], 1)}</td>)}</tr>
              </tbody>
            </table>
            <p className="fi-nota">M2 es la PFI (primera factura impaga): de cada 100 líneas vendidas, {num(zafra[2], 1)} siguen activas al segundo mes. Banda del Ideal ±3,5 puntos
              {fueraBanda.length ? <>: <b>{fueraBanda.length} mes(es) por debajo</b> ({fueraBanda.map((f) => `M${f.i}`).join(", ")}).</> : ": la zafra cargada está dentro de la banda en todos los meses."}</p>
          </div>
        )}

        {/* ===== Tarifas de Claro ===== */}
        <div className="fi-block">
          <h3>Tarifas de Claro por plan (Gs sin IVA)</h3>
          <table className="fi-tabla">
            <thead><tr><th>Plan</th><th>Mix</th><th>Cuota 1 (upfront)</th><th>Cuota 2</th>{esMovil && <th>Plus porta</th>}{esMovil && <th>Abono</th>}{!esMovil && <th>Penalidad mora</th>}</tr></thead>
            <tbody>
              {planes.map((x) => { const nombre = x.plan ?? x.nombre; const b = planBase(nombre); return (
                <tr key={nombre}>
                  <td><b>{nombre}</b></td>
                  <td>{pct(x.mix_pct)}{dif(x.mix_pct, b.mix_pct) && <span className="fi-mod">✱</span>}</td>
                  <td>{gs(x.cuota1)}{dif(x.cuota1, b.cuota1) && <span className="fi-mod">✱</span>}</td>
                  <td>{gs(x.cuota2)}{dif(x.cuota2, b.cuota2) && <span className="fi-mod">✱</span>}</td>
                  {esMovil && <td>{gs(x.porta_plus)}{dif(x.porta_plus, b.porta_plus) && <span className="fi-mod">✱</span>}</td>}
                  {esMovil && <td>{gs(x.abono)}{dif(x.abono, b.abono) && <span className="fi-mod">✱</span>}</td>}
                  {!esMovil && <td>{gs(x.penalidad_mora)}</td>}
                </tr>); })}
              <tr className="fi-total"><td>Ponderado</td><td>{pct(mixTotal, 1)}</td><td>{gs(pond("cuota1"))}</td><td>{gs(pond("cuota2"))}</td>{esMovil && <td>{gs(pond("porta_plus"))}</td>}{esMovil && <td>{gs(pond("abono"))}</td>}{!esMovil && <td></td>}</tr>
            </tbody>
          </table>
          {esMovil && Number(p.ajuste_comisiones_pct) ? <p className="fi-nota">Ajuste de comisiones negociado: {num(p.ajuste_comisiones_pct, 1)} % sobre cuota 1, cuota 2 y plus porta (no toca bonos ni residual).</p> : null}
        </div>

        {/* ===== Bonos y reglas de liquidación ===== */}
        <div className="fi-block">
          <h3>Bonos y reglas de liquidación de Claro</h3>
          <table className="fi-tabla fi-kv"><tbody>
            {esMovil ? (<>
              <Dato label="Objetivo CO (Claro)" value={num(p.objetivo_co)} base={dif(p.objetivo_co, d.objetivo_co)} />
              <Dato label="Líneas en estado A" value={pct(p.pct_estado_a)} base={dif(p.pct_estado_a, d.pct_estado_a)} />
              <Dato label={p.bono_unico ? "Bono único (propuesta 2027)" : "Bono productividad (escala vigente)"} value={escalaTxt(p.escala_productividad)} base={dif(p.escala_productividad, d.escala_productividad)} hint="por línea en estado A" />
              <Dato label="Recálculo del bono" value={`mes ${num(p.recalculo_productividad_mes)} · ${p.pct_recalculo_productividad == null ? "100 % de las caídas al día 180 (según zafra)" : pct(p.pct_recalculo_productividad)}`} base={dif(p.pct_recalculo_productividad, d.pct_recalculo_productividad)} />
              <Dato label="Claro descuenta el bono productividad" value={siNo(p.devolver_bono_productividad)} base={dif(p.devolver_bono_productividad, d.devolver_bono_productividad)} />
              <Dato label="Bono efectividad (entregas)" value={escalaTxt(p.escala_efectividad)} base={dif(p.escala_efectividad, d.escala_efectividad)} />
              <Dato label="Efectividad de entregas" value={pct(p.efectividad_pct)} base={dif(p.efectividad_pct, d.efectividad_pct)} />
              <Dato label="Activaciones que cobran bono efectividad" value={pct(p.pct_bono_efectividad_cobrado)} base={dif(p.pct_bono_efectividad_cobrado, d.pct_bono_efectividad_cobrado)} />
              <Dato label="Claro descuenta el bono efectividad" value={siNo(p.devolver_bono_efectividad)} base={dif(p.devolver_bono_efectividad, d.devolver_bono_efectividad)} />
              <Dato label="Bonos activos" value={siNo(p.bonos_activos)} base={dif(p.bonos_activos, d.bonos_activos)} />
              <Dato label="Bono adicional (mes 1)" value={gs(p.bono_adicional)} base={dif(p.bono_adicional, d.bono_adicional)} />
              <Dato label="Portabilidad" value={pct(p.porta_pct)} base={dif(p.porta_pct, d.porta_pct)} hint="activaciones con plus porta" />
              <Dato label="Cuota 2" value={`mes ${num(p.cuota2_mes)}, líneas activas al día 90`} base={dif(p.cuota2_mes, d.cuota2_mes)} />
              <Dato label="Legajo incompleto / no presentado" value={`${pct(p.legajo_incompleto_pct)} (cobra 50 %) / ${pct(p.legajo_no_presentado_pct)} (100 %)`} base={dif(p.legajo_incompleto_pct, d.legajo_incompleto_pct) || dif(p.legajo_no_presentado_pct, d.legajo_no_presentado_pct)} />
              <Dato label="Residual" value={`${pct(p.residual_pct)} del abono acreditado (${pct(p.pct_abono_acreditado)} del plan), ${num(p.residual_meses)} meses${p.residual_segun_zafra === false ? ", curva fija" : ", sigue a la zafra"}`} base={dif(p.residual_pct, d.residual_pct) || dif(p.pct_abono_acreditado, d.pct_abono_acreditado) || dif(p.residual_meses, d.residual_meses) || dif(p.residual_segun_zafra, d.residual_segun_zafra)} />
              <Dato label="Chargeback" value={`${num(p.chargeback_meses)} meses (180 días)`} base={dif(p.chargeback_meses, d.chargeback_meses)} />
              <Dato label="Caídas que devuelven la cuota 1" value={`${pct(p.pct_caidas_penalizables)}${p.clawback_incluye_residual ? " (+ un residual)" : ""}`} base={dif(p.pct_caidas_penalizables, d.pct_caidas_penalizables)} hint="porta y bono efectividad: 100 %" />
              <Dato label="Recupero por reconexión" value={pct(p.recupero_pct)} base={dif(p.recupero_pct, d.recupero_pct)} />
              <Dato label="Migración de negocio" value={`${pct(p.migracion_negocio_pct)} en el mes ${num(p.migracion_mes)}`} base={dif(p.migracion_negocio_pct, d.migracion_negocio_pct)} />
              <Dato label="Caídas que terminan en baja (Gross Claro)" value={pct(p.pct_bajas_gross)} base={dif(p.pct_bajas_gross, d.pct_bajas_gross)} />
            </>) : (<>
              <Dato label="Objetivo de líneas IF" value={num(p.objetivo)} base={dif(p.objetivo, d.objetivo)} />
              <Dato label="Bono fijo (escala)" value={escalaTxt(p.escala_bono)} base={dif(p.escala_bono, d.escala_bono)} />
              <Dato label="Activaciones que cobran el bono" value={pct(p.pct_bono_cobrado)} base={dif(p.pct_bono_cobrado, d.pct_bono_cobrado)} />
              <Dato label="Recálculo del bono" value={`mes ${num(p.recalculo_mes)} · ${pct(p.pct_recalculo)} de la cohorte`} base={dif(p.pct_recalculo, d.pct_recalculo)} />
              <Dato label="Cuota 2" value={`mes ${num(p.cuota2_mes)} · la cobra ${pct(p.cuota2_pct_lineas)} (${pct(p.cuota2_pct_completa)} completa)`} base={dif(p.cuota2_pct_lineas, d.cuota2_pct_lineas) || dif(p.cuota2_pct_completa, d.cuota2_pct_completa)} />
              <Dato label="Legajo no presentado / incompleto" value={`${pct(p.legajo_no_presentado_pct)} (100 %) / ${pct(p.legajo_pct)} (${pct(p.legajo_pct_cuota1)})`} base={dif(p.legajo_no_presentado_pct, d.legajo_no_presentado_pct) || dif(p.legajo_pct, d.legajo_pct)} />
              <Dato label="Mora" value={`${pct(p.mora_pct_lineas)} de las líneas con deuda neta a 6 meses · ${pct(p.mora_penalidad_pct)} de la penalidad`} base={dif(p.mora_pct_lineas, d.mora_pct_lineas) || dif(p.mora_penalidad_pct, d.mora_penalidad_pct)} />
              <Dato label="Curva de la mora" value={(p.mora_curva_pct || []).map((x: any) => num(x)).join(" · ")} base={dif(p.mora_curva_pct, d.mora_curva_pct)} />
              <Dato label="Chargeback" value={`${num(p.chargeback_meses)} meses`} base={dif(p.chargeback_meses, d.chargeback_meses)} />
              <Dato label="Otros reversos" value={pct(p.otros_pct)} base={dif(p.otros_pct, d.otros_pct)} />
              <Dato label="Ajuste de comisiones" value={pct(p.ajuste_comisiones_pct)} base={dif(p.ajuste_comisiones_pct, d.ajuste_comisiones_pct)} />
            </>)}
          </tbody></table>
        </div>

        {/* ===== Costos de la estructura ===== */}
        <div className="fi-block">
          <h3>Costos de la estructura</h3>
          <table className="fi-tabla fi-kv"><tbody>
            {costosKeys.map((k) => <Dato key={k} label={LABEL[k]} value={fmtCampo(k, c[k])} base={dif(c[k], dc[k])} />)}
          </tbody></table>
        </div>

        {/* ===== GPON por la misma estructura ===== */}
        {esMovil && gponOn && pg && (
          <div className="fi-block">
            <h3>GPON por la misma estructura</h3>
            <table className="fi-tabla fi-kv"><tbody>
              <Dato label="GPON por asesor (mes 1)" value={`${num(gponAsesor[0] ?? 3, 2)} → ${num(Math.round(vendedores * (gponAsesor[0] ?? 3)))} activaciones`} base={dif(gponAsesor[0] ?? 3, 3)} />
              <Dato label="Objetivo del bono fijo" value={gponObjetivoAuto ? `vendedores × 3 = ${num(vendedores * 3)}` : num(pg.objetivo)} base={!gponObjetivoAuto} />
              <Dato label="Planes" value={(pg.planes || []).map((x: any) => `${x.nombre ?? x.plan} ${pct(x.mix_pct)} · C1 ${gs(x.cuota1)} · C2 ${gs(x.cuota2)}`).join(" | ")} base={dif(pg.planes, pgDefaults?.planes)} />
              <Dato label="Bono fijo (escala)" value={escalaTxt(pg.escala_bono)} base={dif(pg.escala_bono, pgDefaults?.escala_bono)} />
              <Dato label="Activaciones que cobran el bono" value={pct(pg.pct_bono_cobrado)} base={dif(pg.pct_bono_cobrado, pgDefaults?.pct_bono_cobrado)} />
              <Dato label="Recálculo del bono" value={`mes ${num(pg.recalculo_mes)} · ${pct(pg.pct_recalculo)}`} base={dif(pg.pct_recalculo, pgDefaults?.pct_recalculo)} />
              <Dato label="Cuota 2" value={`mes ${num(pg.cuota2_mes)} · ${pct(pg.cuota2_pct_lineas)} la cobra (${pct(pg.cuota2_pct_completa)} completa)`} base={dif(pg.cuota2_pct_lineas, pgDefaults?.cuota2_pct_lineas) || dif(pg.cuota2_pct_completa, pgDefaults?.cuota2_pct_completa)} />
              <Dato label="Legajo no presentado / incompleto" value={`${pct(pg.legajo_no_presentado_pct)} / ${pct(pg.legajo_pct)} (${pct(pg.legajo_pct_cuota1)})`} base={dif(pg.legajo_no_presentado_pct, pgDefaults?.legajo_no_presentado_pct) || dif(pg.legajo_pct, pgDefaults?.legajo_pct)} />
              <Dato label="Mora" value={`${pct(pg.mora_pct_lineas)} de las líneas a 6 meses · curva ${(pg.mora_curva_pct || []).map((x: any) => num(x)).join("·")}`} base={dif(pg.mora_pct_lineas, pgDefaults?.mora_pct_lineas) || dif(pg.mora_curva_pct, pgDefaults?.mora_curva_pct)} />
              <Dato label="Ajuste de comisiones GPON" value={pct(pg.ajuste_comisiones_pct)} base={dif(pg.ajuste_comisiones_pct, pgDefaults?.ajuste_comisiones_pct)} />
              <Dato label="Costos variables por venta GPON" value={`comisión ${gs(pg.costos?.comision_por_venta)} · plus ${gs(pg.costos?.plus_por_venta)} · operativos ${gs(pg.costos?.operativo_por_venta)} · documentación ${gs(pg.costos?.documentacion_por_venta)}`} base={dif(pg.costos?.comision_por_venta, pgDefaults?.costos?.comision_por_venta) || dif(pg.costos?.plus_por_venta, pgDefaults?.costos?.plus_por_venta) || dif(pg.costos?.operativo_por_venta, pgDefaults?.costos?.operativo_por_venta) || dif(pg.costos?.documentacion_por_venta, pgDefaults?.costos?.documentacion_por_venta)} />
            </tbody></table>
            <p className="fi-nota">GPON no agrega personas: solo comisión, plus, documentación, operativos y logística por venta; IPS y aguinaldo son los del pospago.</p>
          </div>
        )}

        {/* ===== Meses afectados ===== */}
        {afectadosLista.length > 0 && (
          <div className="fi-block fi-span2">
            <h3>Meses afectados (variaciones propias de un mes)</h3>
            <table className="fi-tabla">
              <thead><tr><th>Mes</th><th>Variación</th><th>Valor del mes</th><th>Valor base</th></tr></thead>
              <tbody>
                {afectadosLista.flatMap(({ mes, ov }) => {
                  const filas: { k: string; v: any; base: any; grupo: string }[] = [];
                  for (const [k, v] of Object.entries(ov || {})) {
                    if (k === "costos") for (const [ck, cv] of Object.entries(v as any)) filas.push({ k: ck, v: cv, base: c[ck], grupo: "" });
                    else if (k === "gpon") for (const [gk, gv] of Object.entries(v as any)) {
                      if (gk === "costos") for (const [ck, cv] of Object.entries(gv as any)) filas.push({ k: ck, v: cv, base: pg?.costos?.[ck], grupo: "GPON · " });
                      else filas.push({ k: gk, v: gv, base: pg?.[gk], grupo: "GPON · " });
                    } else filas.push({ k, v, base: p[k], grupo: "" });
                  }
                  return filas.map((f, j) => (
                    <tr key={`${mes}-${f.grupo}${f.k}`}>
                      {j === 0 ? <td rowSpan={filas.length}><b>{mes}</b> · {nombreMes(mes - 1)}</td> : null}
                      <td>{f.grupo}{LABEL[f.k] || f.k}</td>
                      <td><b>{fmtCampo(f.k, f.v)}</b></td>
                      <td>{fmtCampo(f.k, f.base)}</td>
                    </tr>));
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ===== Notas ===== */}
        {notas.length > 0 && (
          <div className="fi-block fi-span2">
            <h3>Notas y comentarios de la simulación</h3>
            <table className="fi-tabla">
              <thead><tr><th>Tipo</th><th>Nota</th><th>Mes</th><th>Autor · fecha</th></tr></thead>
              <tbody>
                {notas.map((n: any) => (
                  <tr key={n.id || n.texto}>
                    <td className="fi-tipo">{n.tipo}</td>
                    <td>{n.texto}</td>
                    <td>{n.mes ? nombreMes(Number(n.mes) - 1) : "toda la simulación"}</td>
                    <td className="fi-nombre">{n.autor || "—"} · {n.fecha ? new Date(n.fecha).toLocaleDateString("es-PY") : "—"}</td>
                  </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
