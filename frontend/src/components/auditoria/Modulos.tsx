"use client";

import { KpiCard } from "@/components/KpiCard";
import { Seccion, Tabla } from "@/components/ventas-netas/ui";
import { NivelBadge } from "./RiesgosView";
import { TIPO_FUENTE_LABEL, fechaCorta, n, nombrePeriodo, pct, type CruceVendedor, type ModuloDatos, type Snapshot, type TipoFuente } from "./tipos";

type Fila = Record<string, any>;
const num = (v: unknown) => (v === null || v === undefined ? "—" : n(Number(v)));
const d1 = (v: unknown) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("es-PY", { maximumFractionDigits: 1 }));
const p1 = (v: unknown) => (v === null || v === undefined ? "—" : pct(Number(v)));
const BANDA: Record<string, string> = { rojo: "Rojo", bajo: "Bajo", meta: "Meta", sobre: "Sobre" };
const k = (m: ModuloDatos, key: string): any => (m.kpis as any)?.[key];

/** Qué módulos trae el snapshot, en el orden del catálogo. */
export function modulosDe(s: Snapshot): Exclude<TipoFuente, "ventas_netas">[] {
  const orden: Exclude<TipoFuente, "ventas_netas">[] = ["productividad", "sph", "logistica", "supervision", "informe_diario"];
  return orden.filter((t) => s.modulos?.[t]);
}

function Fuentes({ m }: { m: ModuloDatos }) {
  return <span>{m.fuentes.map((f) => f.etiqueta ?? f.periodo).slice(0, 6).join(" · ")}{m.fuentes.length > 6 ? ` y ${m.fuentes.length - 6} más` : ""}</span>;
}

// ------------------------------------------------------------------ cada módulo
function Productividad({ m }: { m: ModuloDatos }) {
  const dias = (m.por_dia as Fila[]) ?? [];
  const agentes = ((m.agentes as Fila[]) ?? []).filter((a) => (a.llamadas ?? 0) >= 20);
  const peores = [...agentes].sort((a, b) => (a.pct_conversacion ?? 0) - (b.pct_conversacion ?? 0)).slice(0, 12);
  return (
    <Seccion titulo="Productividad de llamadas" sub={`${n(k(m, "dias"))} día(s) · fuentes: ${m.fuentes.map((f) => f.etiqueta).slice(0, 8).join(", ")}${m.fuentes.length > 8 ? "…" : ""}`}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <KpiCard label="Conversación" value={p1(k(m, "pct_conversacion"))} hint={`banda ${BANDA[String(k(m, "banda"))] ?? "—"} · meta ${p1(k(m, "meta_min"))}`} accent={k(m, "banda") === "rojo" ? "danger" : k(m, "banda") === "bajo" ? "orange" : "cyan"} />
        <KpiCard label="Llamadas" value={num(k(m, "llamadas"))} hint={`${num(k(m, "llamadas_por_dia"))} por día · ${d1(k(m, "horas_conectadas"))} h conectadas`} accent="secondary" />
        <KpiCard label="Días en rojo" value={num(k(m, "dias_rojo"))} hint={`${num(k(m, "dias_bajo_meta"))} bajo la meta de ${num(k(m, "dias"))}`} accent={k(m, "dias_rojo") ? "danger" : "neutral"} />
        <KpiCard label="Agentes bajo la meta" value={num(k(m, "agentes_bajo_meta"))} hint={`de ${num(k(m, "agentes"))} · ${num(k(m, "agentes_con_alertas"))} con sesión abierta o sin llamadas`} accent="orange" />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate font-semibold mb-1.5">Por día</div>
          <Tabla<Fila> cols={[
            { key: "fecha", label: "Día", render: (r) => fechaCorta(r.fecha) },
            { key: "agentes", label: "Agentes", align: "right", render: (r) => num(r.agentes) },
            { key: "llamadas", label: "Llamadas", align: "right", render: (r) => num(r.llamadas) },
            { key: "pct_conversacion", label: "Conv.", align: "right", render: (r) => p1(r.pct_conversacion) },
            { key: "banda", label: "Banda", render: (r) => <span className={r.banda === "rojo" ? "font-semibold text-brand-primary" : r.banda === "bajo" ? "text-brand-orange font-semibold" : ""}>{BANDA[r.banda] ?? "—"}</span> },
            { key: "pct_contacto", label: "Contacto", align: "right", render: (r) => p1(r.pct_contacto) },
          ]} rows={dias} alerta={(r) => r.banda === "rojo"} maxAlto="max-h-72" />
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate font-semibold mb-1.5">Agentes con peor conversación (20+ llamadas)</div>
          <Tabla<Fila> cols={[
            { key: "nombre", label: "Agente", render: (r) => <b>{r.nombre}</b> },
            { key: "dias", label: "Días", align: "right", render: (r) => num(r.dias) },
            { key: "llamadas", label: "Llamadas", align: "right", render: (r) => num(r.llamadas) },
            { key: "pct_conversacion", label: "Conv.", align: "right", render: (r) => p1(r.pct_conversacion) },
            { key: "banda", label: "Banda", render: (r) => BANDA[r.banda] ?? "—" },
            { key: "alertas", label: "Alertas", render: (r) => ((r.alertas as string[]) ?? []).join(", ") || "—" },
          ]} rows={peores} alerta={(r) => r.banda === "rojo"} maxAlto="max-h-72" />
        </div>
      </div>
    </Seccion>
  );
}

function Sph({ m }: { m: ModuloDatos }) {
  const agentes = (m.agentes as Fila[]) ?? [];
  const sphOp = Number(k(m, "sph") ?? 0);
  return (
    <Seccion titulo="SPH · ventas por hora conectada" sub={`${n(k(m, "informes"))} informe(s) · fuentes: ${m.fuentes.map((f) => f.etiqueta).slice(0, 6).join(", ")}`}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <KpiCard label="SPH de la operación" value={d1(k(m, "sph"))} hint={`${num(k(m, "ventas"))} ventas en ${d1(k(m, "horas"))} h`} accent="secondary" />
        <KpiCard label="Agentes" value={num(k(m, "agentes"))} hint={`${num(k(m, "vinculados"))} vinculados a un vendedor`} accent="cyan" />
        <KpiCard label="Muy sobre la media" value={num(k(m, "asesores_muy_sobre_media"))} hint="asesores con el doble o más del SPH (4+ h)" accent={k(m, "asesores_muy_sobre_media") ? "orange" : "neutral"} />
        <KpiCard label="Ventas sin agente" value={num(k(m, "ventas_sin_agente"))} hint="de vendedores sin agente conectado" accent={k(m, "ventas_sin_agente") ? "danger" : "neutral"} />
      </div>
      <Tabla<Fila> cols={[
        { key: "agente", label: "Agente", render: (r) => <b>{r.agente}</b> },
        { key: "vendedor", label: "Vendedor", render: (r) => r.vendedor ?? <span className="text-brand-mist">sin vincular</span> },
        { key: "dias", label: "Días", align: "right", render: (r) => num(r.dias) },
        { key: "horas", label: "Horas", align: "right", render: (r) => d1(r.horas) },
        { key: "ventas", label: "Ventas", align: "right", render: (r) => num(r.ventas) },
        { key: "sph", label: "SPH", align: "right", render: (r) => <b className={sphOp && r.sph >= 2 * sphOp ? "text-brand-orange" : ""}>{d1(r.sph)}</b> },
        { key: "sesion_abierta", label: "Sesión", render: (r) => (r.sesion_abierta ? <span className="badge-primary">abierta</span> : "ok") },
      ]} rows={agentes.slice(0, 40)} alerta={(r) => !!sphOp && r.sph >= 2 * sphOp} maxAlto="max-h-80" />
      {(m.avisos as string[])?.length ? <ul className="mt-3 text-xs text-brand-slate list-disc pl-5 space-y-0.5">{(m.avisos as string[]).map((a, i) => <li key={i}>{a}</li>)}</ul> : null}
    </Seccion>
  );
}

function Logistica({ m }: { m: ModuloDatos }) {
  const vendedores = ((m.vendedores as Fila[]) ?? []).filter((v) => v.devuelto || v.en_gestion).slice(0, 20);
  const vencidos = (m.pendientes_vencidos as Fila[]) ?? [];
  return (
    <Seccion titulo="Logística de entregas" sub={`${n(k(m, "cortes"))} corte(s) · fuentes: ${m.fuentes.map((f) => f.etiqueta).join(", ")}`}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <KpiCard label="Entregados" value={p1(k(m, "pct_entregados"))} hint={`${num(k(m, "entregados"))} de ${num(k(m, "pedidos"))} pedidos · entrega prom. ${d1(k(m, "entrega_prom"))} d`} accent="cyan" />
        <KpiCard label="Pendientes vencidos" value={num(k(m, "vencidos"))} hint={`en gestión con 6+ días hábiles · ${num(k(m, "vencidos_11"))} con 11+ · demora prom. ${d1(k(m, "demora_prom"))} d`} accent={k(m, "vencidos") ? "danger" : "neutral"} />
        <KpiCard label="Devueltos" value={num(k(m, "devueltos"))} hint={`${p1(k(m, "pct_devueltos"))} · ${num(k(m, "vendedores_con_devoluciones"))} vendedor(es) con devoluciones`} accent="orange" />
        <KpiCard label="En gestión" value={num(k(m, "en_gestion"))} hint="pedidos sin entregar al corte" accent="secondary" />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate font-semibold mb-1.5">Vendedores con devoluciones o pendientes</div>
          <Tabla<Fila> cols={[
            { key: "vendedor", label: "Vendedor", render: (r) => <b>{r.vendedor}</b> },
            { key: "total", label: "Pedidos", align: "right", render: (r) => num(r.total) },
            { key: "entregado", label: "Entreg.", align: "right", render: (r) => num(r.entregado) },
            { key: "en_gestion", label: "En gestión", align: "right", render: (r) => num(r.en_gestion) },
            { key: "devuelto", label: "Devueltos", align: "right", render: (r) => <b className={r.devuelto ? "text-brand-primary" : ""}>{num(r.devuelto)}</b> },
            { key: "pct_devuelto", label: "% dev.", align: "right", render: (r) => p1(r.pct_devuelto) },
          ]} rows={vendedores} alerta={(r) => (r.devuelto ?? 0) >= 2 && (r.pct_devuelto ?? 0) >= 20} maxAlto="max-h-72" />
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate font-semibold mb-1.5">Pedidos en gestión con 6+ días hábiles</div>
          <Tabla<Fila> cols={[
            { key: "dias", label: "Días", align: "right", render: (r) => <b className={r.dias >= 11 ? "text-brand-purple" : "text-brand-primary"}>{num(r.dias)}</b> },
            { key: "cliente", label: "Cliente", render: (r) => <>{r.cliente}<div className="text-brand-slate text-[11px]">{r.formulario}</div></> },
            { key: "ciudad", label: "Ciudad", render: (r) => <>{r.ciudad} <span className="text-brand-slate">{r.region}</span></> },
            { key: "fecha", label: "Venta", render: (r) => fechaCorta(r.fecha) },
            { key: "motivo", label: "Motivo" },
            { key: "vendedor", label: "Vendedor" },
          ]} rows={vencidos} maxAlto="max-h-72" vacio="Sin pendientes vencidos." />
        </div>
      </div>
      {(m.motivos_devueltos as Fila[])?.length ? (
        <p className="text-xs text-brand-slate mt-3">Motivos de devolución: {(m.motivos_devueltos as Fila[]).map((x) => `${x.motivo} (${n(x.total)})`).join(" · ")}</p>
      ) : null}
    </Seccion>
  );
}

function Supervision({ m }: { m: ModuloDatos }) {
  const meses = (m.meses as Fila[]) ?? [];
  const alertas = ((m.alertas as Fila[]) ?? []).filter((a) => a.abierta).slice(0, 30);
  const tickets = ((m.tickets as Fila[]) ?? []).filter((t) => t.cumple_sla === false).slice(0, 20);
  const coach = ((m.coachings as Fila[]) ?? []).filter((c) => c.seguimiento === "vencido").slice(0, 20);
  return (
    <Seccion titulo="Supervisión · objetivos, alertas, coaching y tickets" sub={`${meses.map((x) => x.nombre).join(", ")}`}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <KpiCard label="Asesores en alerta" value={num(k(m, "alertas_abiertas"))} hint={`${num(k(m, "alertas"))} alertas en el período · ${num(k(m, "asesores_en_alerta"))} al corte`} accent={k(m, "alertas_abiertas") ? "danger" : "neutral"} />
        <KpiCard label="Coachings" value={num(k(m, "coachings"))} hint={`${num(k(m, "coaching_vencidos"))} con seguimiento vencido`} accent={k(m, "coaching_vencidos") ? "orange" : "cyan"} />
        <KpiCard label="Tickets" value={num(k(m, "tickets"))} hint={`${num(k(m, "tickets_fuera_sla"))} fuera de SLA`} accent={k(m, "tickets_fuera_sla") ? "danger" : "secondary"} />
        <KpiCard label="Meses" value={num(k(m, "meses"))} hint={meses.map((x) => `${x.nombre}: ${x.operacion?.supervisores_criticos ?? 0} sup. críticos`).join(" · ")} accent="neutral" />
      </div>
      {meses.map((mes) => (
        <div key={mes.periodo} className="mb-4">
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate font-semibold mb-1.5">{mes.nombre} · Pospago {num(mes.pospago?.vendido)} de {num(mes.pospago?.objetivo)} (proy. {num(mes.pospago?.proyeccion)}) · GPON {num(mes.gpon?.vendido)} de {num(mes.gpon?.objetivo)}</div>
          <Tabla<Fila> cols={[
            { key: "nombre", label: "Supervisor", render: (r) => <b>{r.nombre}</b> },
            { key: "asesores", label: "Asesores", align: "right", render: (r) => num(r.asesores) },
            { key: "pospago", label: "Pospago", align: "right", render: (r) => `${num(r.pospago?.vendido)} / ${num(r.pospago?.objetivo)}` },
            { key: "proy", label: "Proy.", align: "right", render: (r) => num(r.pospago?.proyeccion) },
            { key: "gpon", label: "GPON", align: "right", render: (r) => `${num(r.gpon?.vendido)} / ${num(r.gpon?.objetivo)}` },
            { key: "asesores_en_alerta", label: "En alerta", align: "right", render: (r) => <b className={r.asesores_en_alerta ? "text-brand-primary" : ""}>{num(r.asesores_en_alerta)}</b> },
          ]} rows={(mes.supervisores as Fila[]) ?? []} alerta={(r) => !!r.critico} maxAlto="max-h-60" vacio="Sin supervisores con equipo cargado." />
        </div>
      ))}
      <div className="grid lg:grid-cols-3 gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate font-semibold mb-1.5">Alertas abiertas</div>
          <Tabla<Fila> cols={[
            { key: "operador", label: "Asesor", render: (r) => <b>{r.operador}</b> },
            { key: "tipo", label: "Tipo" },
            { key: "desde", label: "Desde", render: (r) => fechaCorta(r.desde) },
          ]} rows={alertas} maxAlto="max-h-60" vacio="Sin alertas abiertas." />
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate font-semibold mb-1.5">Coachings con seguimiento vencido</div>
          <Tabla<Fila> cols={[
            { key: "operador", label: "Asesor", render: (r) => <b>{r.operador}</b> },
            { key: "supervisor", label: "Supervisor" },
            { key: "seguimiento_fecha", label: "Seguía el", render: (r) => fechaCorta(r.seguimiento_fecha) },
          ]} rows={coach} maxAlto="max-h-60" vacio="Sin seguimientos vencidos." />
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate font-semibold mb-1.5">Tickets fuera de SLA</div>
          <Tabla<Fila> cols={[
            { key: "numero", label: "#", align: "right", render: (r) => `#${r.numero}` },
            { key: "tipo", label: "Tipo" },
            { key: "supervisor", label: "Supervisor" },
            { key: "estado", label: "Estado" },
          ]} rows={tickets} maxAlto="max-h-60" vacio="Todos los tickets dentro del SLA." />
        </div>
      </div>
    </Seccion>
  );
}

function InformeDiario({ m }: { m: ModuloDatos }) {
  const meses = (m.meses as Fila[]) ?? [];
  const cumplimiento = meses.flatMap((x) => ((x.cumplimiento as Fila[]) ?? []).map((a) => ({ ...a, mes: x.nombre })));
  const compromisos = ((m.compromisos as Fila[]) ?? []).filter((c) => c.vencido || c.estado === "abierto").slice(0, 20);
  return (
    <Seccion titulo="Informe diario · firmados y compromisos" sub={meses.map((x) => x.nombre).join(", ")}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <KpiCard label="Informes firmados" value={num(k(m, "firmados"))} hint={`${num(k(m, "informes"))} informes en total`} accent="cyan" />
        <KpiCard label="Días sin informe" value={num(k(m, "dias_sin_informe"))} hint="días esperados sin informe firmado" accent={k(m, "dias_sin_informe") ? "orange" : "neutral"} />
        <KpiCard label="Métricas críticas" value={num(k(m, "metricas_criticas"))} hint="declaradas críticas en los informes" accent="secondary" />
        <KpiCard label="Compromisos vencidos" value={num(k(m, "compromisos_vencidos"))} hint={`${num(k(m, "compromisos_abiertos"))} abiertos`} accent={k(m, "compromisos_vencidos") ? "danger" : "neutral"} />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate font-semibold mb-1.5">Cumplimiento por autor</div>
          <Tabla<Fila> cols={[
            { key: "nombre", label: "Autor", render: (r) => <><b>{r.nombre}</b> <span className="text-brand-slate text-xs">{r.cargo}</span></> },
            { key: "mes", label: "Mes" },
            { key: "firmados", label: "Firmados", align: "right", render: (r) => `${num(r.firmados)} / ${num(r.esperados)}` },
            { key: "pct", label: "%", align: "right", render: (r) => p1(r.pct) },
            { key: "dias_sin_informe", label: "Sin informe", render: (r) => ((r.dias_sin_informe as string[]) ?? []).map(fechaCorta).join(", ") || "—" },
          ]} rows={cumplimiento} alerta={(r) => ((r.dias_sin_informe as string[]) ?? []).length >= 3} maxAlto="max-h-72" vacio="Sin autores en el período." />
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate font-semibold mb-1.5">Compromisos abiertos o vencidos</div>
          <Tabla<Fila> cols={[
            { key: "autor", label: "Autor", render: (r) => <b>{r.autor ?? "—"}</b> },
            { key: "metrica", label: "Métrica" },
            { key: "texto", label: "Compromiso" },
            { key: "fecha_limite", label: "Límite", render: (r) => <span className={r.vencido ? "font-semibold text-brand-primary" : ""}>{fechaCorta(r.fecha_limite)}</span> },
          ]} rows={compromisos} alerta={(r) => !!r.vencido} maxAlto="max-h-72" vacio="Sin compromisos abiertos." />
        </div>
      </div>
    </Seccion>
  );
}

function Cruce({ cruce }: { cruce: CruceVendedor[] }) {
  const con = cruce.filter((c) => c.senales.some((s) => !s.startsWith("sin alerta")));
  return (
    <Seccion titulo="Cruce por vendedor" sub={`${n(cruce.length)} vendedores riesgosos de Ventas Netas y lo que dicen de ellos las otras fuentes · ${n(con.length)} con señales`}>
      <Tabla<CruceVendedor> cols={[
        { key: "nivel", label: "Nivel", render: (r) => <NivelBadge nivel={r.nivel} /> },
        { key: "vendedor", label: "Vendedor", render: (r) => <b>{r.vendedor}</b> },
        { key: "sin_uso", label: "Sin uso", align: "right", render: (r) => `${n(r.sin_uso)} (${pct(r.pct_sin_uso)})` },
        { key: "sph", label: "SPH", align: "right", render: (r) => (r.sph ? <span className={r.sph.sobre_media ? "font-semibold text-brand-orange" : ""}>{d1(r.sph.sph)} · {d1(r.sph.horas)} h</span> : "—") },
        { key: "logistica", label: "Entregas", align: "right", render: (r) => (r.logistica ? `${n(r.logistica.entregado)}/${n(r.logistica.total)} · ${n(r.logistica.devuelto)} dev.` : "—") },
        { key: "supervision", label: "Supervisión", render: (r) => (r.supervision ? `${n(r.supervision.alertas)} alertas · ${n(r.supervision.coachings)} coach · ${n(r.supervision.tickets)} tickets` : "—") },
        { key: "senales", label: "Señales", render: (r) => <ul className="text-xs list-disc pl-4">{r.senales.map((s, i) => <li key={i} className={s.startsWith("sin alerta") ? "text-brand-slate" : "text-brand-graphite"}>{s}</li>)}</ul> },
      ]} rows={cruce} alerta={(r) => r.nivel === "critico" && r.senales.filter((s) => !s.startsWith("sin alerta")).length >= 2} maxAlto="max-h-[60vh]" vacio="Sin vendedores riesgosos para cruzar." />
    </Seccion>
  );
}

/** Las secciones de las otras fuentes congeladas en el informe, en pantalla (Riesgos y pestaña Resumen). */
export function ModulosView({ s }: { s: Snapshot }) {
  const tipos = modulosDe(s);
  if (!tipos.length && !s.cruce?.length) return null;
  return (
    <div className="space-y-6">
      {s.cruce && s.cruce.length > 0 && <Cruce cruce={s.cruce} />}
      {tipos.map((t) => {
        const m = s.modulos![t]!;
        if (t === "productividad") return <Productividad key={t} m={m} />;
        if (t === "sph") return <Sph key={t} m={m} />;
        if (t === "logistica") return <Logistica key={t} m={m} />;
        if (t === "supervision") return <Supervision key={t} m={m} />;
        return <InformeDiario key={t} m={m} />;
      })}
    </div>
  );
}

/** Resumen de cada módulo en una tarjeta (para el informe ejecutivo y el impreso). */
export function ResumenModulos({ s }: { s: Snapshot }) {
  const tipos = modulosDe(s);
  if (!tipos.length) return null;
  const linea = (t: Exclude<TipoFuente, "ventas_netas">, m: ModuloDatos): [string, string, string] => {
    switch (t) {
      case "productividad": return ["Conversación", p1(k(m, "pct_conversacion")), `${num(k(m, "dias"))} días · ${num(k(m, "dias_rojo"))} en rojo · ${num(k(m, "agentes_bajo_meta"))} agentes bajo la meta`];
      case "sph": return ["SPH de la operación", d1(k(m, "sph")), `${num(k(m, "ventas"))} ventas en ${d1(k(m, "horas"))} h · ${num(k(m, "asesores_muy_sobre_media"))} asesores muy sobre la media · ${num(k(m, "ventas_sin_agente"))} ventas sin agente`];
      case "logistica": return ["Entregas", p1(k(m, "pct_entregados")), `${num(k(m, "pedidos"))} pedidos · ${num(k(m, "vencidos"))} vencidos (6+ d háb.) · ${num(k(m, "devueltos"))} devueltos`];
      case "supervision": return ["Supervisión", `${num(k(m, "alertas_abiertas"))} alertas`, `${num(k(m, "coachings"))} coachings (${num(k(m, "coaching_vencidos"))} vencidos) · ${num(k(m, "tickets"))} tickets (${num(k(m, "tickets_fuera_sla"))} fuera de SLA)`];
      default: return ["Informe diario", `${num(k(m, "firmados"))} firmados`, `${num(k(m, "dias_sin_informe"))} días sin informe · ${num(k(m, "metricas_criticas"))} métricas críticas · ${num(k(m, "compromisos_vencidos"))} compromisos vencidos`];
    }
  };
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {tipos.map((t) => {
        const [l, v, h] = linea(t, s.modulos![t]!);
        return (
          <div key={t} className="card p-3">
            <div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate">{TIPO_FUENTE_LABEL[t]}</div>
            <div className="font-display text-2xl text-brand-ink">{v} <span className="font-sans text-sm text-brand-slate">{l.toLowerCase()}</span></div>
            <div className="text-[11px] text-brand-slate">{h}</div>
            <div className="text-[11px] text-brand-mist mt-1"><Fuentes m={s.modulos![t]!} /></div>
          </div>
        );
      })}
    </div>
  );
}

export const nombreTipo = (t: string) => TIPO_FUENTE_LABEL[t as TipoFuente] ?? t;
export const periodoCorto = (p: string) => nombrePeriodo(p);
