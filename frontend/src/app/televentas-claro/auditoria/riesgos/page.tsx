"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ModulosView } from "@/components/auditoria/Modulos";
import { RiesgosView } from "@/components/auditoria/RiesgosView";
import {
  AUD_API, AUD_HREF, TIPO_FUENTE_LABEL, fechaCorta, n, nombrePeriodo, pct,
  type CatalogoFuentes, type CatalogoTipo, type Fuente, type FuenteItem, type FuenteSeleccion, type Snapshot, type TipoFuente,
} from "@/components/auditoria/tipos";
import { apiFetch } from "@/lib/api";

const STATUS_LABEL: Record<string, string> = { published: "Publicado", draft: "Borrador", replaced: "Reemplazado" };
const badge = (status: string) => (status === "published" ? "badge-success" : status === "draft" ? "badge-cyan" : "badge-neutral");

export default function RiesgosPage() {
  return (
    <AppShell>
      <Riesgos />
    </AppShell>
  );
}

/** Lo que cada ítem muestra debajo de su etiqueta, según el módulo. */
function detalleItem(t: TipoFuente, f: FuenteItem): string {
  const x = f as Record<string, any>;
  switch (t) {
    case "productividad": return `${n(x.agentes)} agentes · ${n(x.llamadas)} llamadas · ${x.pct_conversacion != null ? pct(x.pct_conversacion) : "—"} conv.${x.banda ? ` (${x.banda})` : ""}`;
    case "sph": return `SPH ${x.sph ?? "—"} · ${n(x.ventas)} ventas · ${n(x.agentes)} agentes`;
    case "logistica": return `${n(x.pedidos)} pedidos · ${pct(x.pct_entregados)} entregados · ${n(x.en_gestion)} en gestión · ${n(x.devueltos)} devueltos`;
    case "supervision": return `${n(x.alertas)} alertas · ${n(x.coachings)} coachings · ${n(x.tickets)} tickets`;
    case "informe_diario": return `${n(x.firmados)} informes firmados · ${n(x.autores)} autores`;
    default: return "";
  }
}

function Riesgos() {
  const router = useRouter();
  const [catalogo, setCatalogo] = useState<CatalogoFuentes | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());                       // informes de Ventas Netas
  const [otras, setOtras] = useState<Map<string, Set<string>>>(new Map());      // tipo → ids
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [analizando, setAnalizando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crear, setCrear] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [alcance, setAlcance] = useState("");
  const [creando, setCreando] = useState(false);
  const [abierto, setAbierto] = useState<Set<string>>(new Set());

  useEffect(() => {
    apiFetch<CatalogoFuentes>(`${AUD_API}/fuentes`)
      .then((c) => {
        setCatalogo(c);
        // Por defecto: el publicado de cada mes; si no hay, el corte más reciente.
        const porPeriodo = new Map<string, Fuente>();
        for (const x of c.ventas_netas) {
          const cur = porPeriodo.get(x.periodo);
          if (!cur || (x.status === "published" && cur.status !== "published") || (cur.status !== "published" && (x.fecha_dato ?? "") > (cur.fecha_dato ?? ""))) porPeriodo.set(x.periodo, x);
        }
        const ultimo = [...porPeriodo.values()].sort((a, b) => b.periodo.localeCompare(a.periodo))[0];
        setSel(new Set(ultimo ? [ultimo.id] : []));
      })
      .catch((e) => setError(e.message));
  }, []);

  const fuentes = catalogo?.ventas_netas ?? null;
  const porPeriodo = useMemo(() => {
    const m = new Map<string, Fuente[]>();
    for (const f of fuentes ?? []) m.set(f.periodo, [...(m.get(f.periodo) ?? []), f]);
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [fuentes]);
  const periodosSel = new Set((fuentes ?? []).filter((f) => sel.has(f.id)).map((f) => f.periodo));
  const conflicto = (fuentes ?? []).filter((f) => sel.has(f.id)).length !== periodosSel.size;
  const tiposOtras = useMemo(() => (catalogo?.tipos ?? []).filter((t) => t.tipo !== "ventas_netas"), [catalogo]);
  const totalOtras = [...otras.values()].reduce((a, s) => a + s.size, 0);
  const total = sel.size + totalOtras;
  const seleccion: FuenteSeleccion[] = [...otras.entries()].flatMap(([tipo, ids]) => [...ids].map((id) => ({ tipo: tipo as TipoFuente, id })));

  const toggle = (f: Fuente) => {
    const s = new Set(sel);
    if (s.has(f.id)) s.delete(f.id);
    else {
      // Un solo corte por mes: reemplaza el que estuviera elegido de ese período.
      for (const x of fuentes ?? []) if (x.periodo === f.periodo) s.delete(x.id);
      s.add(f.id);
    }
    setSel(s);
    setSnapshot(null);
  };
  const toggleOtra = (tipo: string, ids: string[], marcar?: boolean) => {
    const m = new Map(otras);
    const s = new Set(m.get(tipo) ?? []);
    const poner = marcar ?? !ids.every((id) => s.has(id));
    for (const id of ids) (poner ? s.add(id) : s.delete(id));
    if (s.size) m.set(tipo, s); else m.delete(tipo);
    setOtras(m);
    setSnapshot(null);
  };
  const toggleAbierto = (tipo: string) => {
    const s = new Set(abierto);
    if (s.has(tipo)) s.delete(tipo); else s.add(tipo);
    setAbierto(s);
  };

  const cuerpo = () => JSON.stringify({ report_ids: [...sel], fuentes: seleccion });
  const analizar = async () => {
    setAnalizando(true);
    setError(null);
    try {
      setSnapshot(await apiFetch<Snapshot>(`${AUD_API}/riesgos`, { method: "POST", body: cuerpo() }));
    } catch (e: any) { setError(e.message); } finally { setAnalizando(false); }
  };

  const abrirCrear = () => {
    const per = [...new Set([...periodosSel, ...seleccion.map((f) => {
      const item = tiposOtras.find((t) => t.tipo === f.tipo)?.items.find((i) => i.id === f.id);
      return item?.periodo ?? "";
    }).filter(Boolean)])].sort();
    const rango = per.length === 0 ? "" : per.length === 1 ? nombrePeriodo(per[0]) : `${nombrePeriodo(per[0])} a ${nombrePeriodo(per[per.length - 1])}`;
    const nombres = [...(sel.size ? ["Ventas Netas"] : []), ...[...otras.keys()].map((t) => TIPO_FUENTE_LABEL[t as TipoFuente] ?? t)];
    setTitulo(`Auditoría de ventas · ${rango}`);
    setAlcance(
      `Revisión de la operación de Televentas CLARO de ${per.map(nombrePeriodo).join(", ")} con las fuentes: ${nombres.join(", ")}. `
      + (sel.size ? "Ventas Netas: líneas sin uso (alerta PFI), portaciones Sali Hablando, riesgo de las cargas, cargas pendientes y finalizadas sin activar, y comportamiento por vendedor. " : "")
      + (otras.has("productividad") ? "Productividad: conversación por día y por agente. " : "")
      + (otras.has("sph") ? "SPH: ventas por hora conectada de la operación y por asesor. " : "")
      + (otras.has("logistica") ? "Logística: entregas, pendientes vencidos y devoluciones por vendedor. " : "")
      + (otras.has("supervision") ? "Supervisión: objetivos, asesores en alerta, coaching y tickets. " : "")
      + (otras.has("informe_diario") ? "Informe diario: cumplimiento, métricas críticas y compromisos. " : "")
      + "Las fuentes se cruzan por vendedor.",
    );
    setCrear(true);
  };
  const crearInforme = async () => {
    setCreando(true);
    setError(null);
    try {
      const a = await apiFetch<{ id: string }>(`${AUD_API}/informes`, { method: "POST", body: JSON.stringify({ titulo, alcance, report_ids: [...sel], fuentes: seleccion }) });
      router.push(`${AUD_HREF}/informes/${a.id}`);
    } catch (e: any) { setError(e.message); setCreando(false); }
  };

  return (
    <>
      <div className="mb-6">
        <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Auditoría de Ventas</div>
        <h1 className="font-display text-4xl text-brand-ink uppercase leading-tight">Riesgos</h1>
        <p className="text-sm text-brand-slate mt-2 max-w-3xl">
          Elegí qué auditar: los informes de Ventas Netas (uno por mes) y, si querés, los datos de los otros módulos que tu perfil ve
          (días de Productividad, informes de SPH, cortes de Logística, meses de Supervisión e Informe diario). El análisis muestra los
          riesgos en vivo y cruza las fuentes por vendedor; desde ahí se crea el informe de auditoría con esos datos congelados.
        </p>
      </div>

      {error && <div className="card p-4 text-brand-primary mb-4">{error}</div>}

      <section className="card p-5 mb-6">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <h2 className="font-display text-lg text-brand-ink uppercase">Ventas Netas</h2>
            <p className="text-xs text-brand-slate">El ranking de vendedores y las líneas salen de acá. Un corte por mes.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={analizar} disabled={total === 0 || analizando || conflicto} className="btn-secondary">{analizando ? "Analizando…" : `Analizar ${total} fuente${total === 1 ? "" : "s"}`}</button>
            <button data-voi="crear" onClick={abrirCrear} disabled={total === 0 || conflicto} className="btn-primary">Crear informe de auditoría</button>
          </div>
        </div>
        {!fuentes ? (
          <div className="text-brand-slate text-sm">Cargando…</div>
        ) : fuentes.length === 0 ? (
          <div className="text-brand-slate text-sm">No hay informes de Ventas Netas todavía. Subí un corte en Ventas Netas para poder auditarlo, o auditá con las otras fuentes de abajo.</div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {porPeriodo.map(([periodo, lista]) => (
              <div key={periodo} className="rounded-lg border border-brand-border p-3">
                <div className="font-display text-lg text-brand-ink uppercase mb-2">{nombrePeriodo(periodo)}</div>
                <ul className="space-y-1.5">
                  {lista.map((f) => (
                    <li key={f.id}>
                      <label className={`flex items-start gap-2 rounded-md p-2 cursor-pointer text-sm ${sel.has(f.id) ? "bg-brand-primary-light/60" : "hover:bg-brand-bg"}`}>
                        <input type="checkbox" className="mt-0.5" checked={sel.has(f.id)} onChange={() => toggle(f)} />
                        <span>
                          <span className="font-semibold">Corte al {fechaCorta(f.fecha_dato)}</span>{" "}
                          <span className={badge(f.status)}>{STATUS_LABEL[f.status]}</span>
                          {!f.actualizada && <span className="badge-orange ml-1" title={`Analizado con la versión ${f.analysis_version}; la auditoría lo recalcula sola al analizarlo.`}>Se actualiza al analizar</span>}
                          <span className="block text-xs text-brand-slate">{n(f.netas)} netas · {n(f.pospago_sin_uso)} sin uso ({pct(f.pct_sin_uso)}) · {n(f.pendientes)} pendientes</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {catalogo && (
        <section className="card p-5 mb-6">
          <div className="mb-3">
            <h2 className="font-display text-lg text-brand-ink uppercase">Otras fuentes</h2>
            <p className="text-xs text-brand-slate">Cualquier dato disponible de los módulos que tu perfil ve. Se congelan en el informe y se cruzan por vendedor con Ventas Netas. Facturación nunca entra.</p>
          </div>
          <div className="space-y-3">
            {tiposOtras.map((t) => <TipoFuenteCard key={t.tipo} t={t} sel={otras.get(t.tipo) ?? new Set()} abierto={abierto.has(t.tipo)} onAbrir={() => toggleAbierto(t.tipo)} onToggle={(ids, marcar) => toggleOtra(t.tipo, ids, marcar)} />)}
          </div>
        </section>
      )}

      {snapshot && (
        <div className="space-y-6">
          <RiesgosView s={snapshot} />
          <ModulosView s={snapshot} />
        </div>
      )}
      {!snapshot && catalogo && total > 0 && (
        <div className="card p-10 text-center text-brand-slate">Tocá <b>Analizar</b> para ver los riesgos de las {n(total)} fuente{total === 1 ? "" : "s"} elegida{total === 1 ? "" : "s"}.</div>
      )}

      {crear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-brand-ink/50 backdrop-blur-[2px]" onClick={() => !creando && setCrear(false)} />
          <div role="dialog" aria-modal="true" className="relative w-full max-w-xl card shadow-elevated animate-pop">
            <div className="h-1.5 bg-brand-primary" />
            <div className="p-6 space-y-4">
              <div>
                <h2 className="font-display text-2xl text-brand-ink uppercase leading-tight">Nuevo informe de auditoría</h2>
                <p className="text-sm text-brand-slate mt-1">Se congelan los datos de {total} fuente{total === 1 ? "" : "s"} ({[...(sel.size ? [`${sel.size} de Ventas Netas`] : []), ...[...otras.entries()].map(([t, s]) => `${s.size} de ${TIPO_FUENTE_LABEL[t as TipoFuente]}`)].join(", ")}) y se generan los hallazgos automáticos. Después lo trabajás en Borrador.</p>
              </div>
              <div>
                <label className="label">Título</label>
                <input className="input" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
              </div>
              <div>
                <label className="label">Alcance</label>
                <textarea className="input min-h-[120px]" value={alcance} onChange={(e) => setAlcance(e.target.value)} />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setCrear(false)} disabled={creando} className="btn-secondary">Cancelar</button>
                <button onClick={crearInforme} disabled={creando || titulo.trim().length < 3} className="btn-primary">{creando ? "Creando…" : "Crear informe"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Un módulo del catálogo: sus ítems por mes, con «todo el mes» para los que tienen muchos (días de Productividad). */
function TipoFuenteCard({ t, sel, abierto, onAbrir, onToggle }: {
  t: CatalogoTipo; sel: Set<string>; abierto: boolean; onAbrir: () => void; onToggle: (ids: string[], marcar?: boolean) => void;
}) {
  const porMes = useMemo(() => {
    const m = new Map<string, FuenteItem[]>();
    for (const f of t.items) m.set(f.periodo, [...(m.get(f.periodo) ?? []), f]);
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [t.items]);
  const porMesCompleto = t.tipo === "supervision" || t.tipo === "informe_diario";
  return (
    <div className={`rounded-lg border p-3 ${sel.size ? "border-brand-primary/40 bg-brand-primary-light/20" : "border-brand-border"}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button type="button" className="text-left flex items-center gap-2" onClick={onAbrir} disabled={!t.habilitado || !t.items.length}>
          <span className="text-brand-slate text-xs w-3">{abierto ? "▾" : "▸"}</span>
          <span className="font-display text-base text-brand-ink uppercase">{t.nombre}</span>
          <span className="text-xs text-brand-slate">{t.descripcion}</span>
        </button>
        <div className="text-xs text-brand-slate whitespace-nowrap">
          {!t.habilitado ? <span className="badge-neutral">Tu perfil no ve este módulo</span>
            : !t.items.length ? <span className="badge-neutral">Sin datos cargados</span>
            : sel.size ? <span className="badge-primary">{n(sel.size)} de {n(t.items.length)} elegido{sel.size === 1 ? "" : "s"}</span>
            : <span>{n(t.items.length)} {t.unidad}{t.items.length === 1 ? "" : t.unidad.endsWith("s") ? "" : "s"} disponible{t.items.length === 1 ? "" : "s"}</span>}
          {t.habilitado && t.items.length > 0 && (
            <button type="button" className="ml-3 font-semibold text-brand-primary" onClick={() => onToggle(t.items.map((i) => i.id), sel.size !== t.items.length)}>{sel.size === t.items.length ? "Quitar todo" : "Elegir todo"}</button>
          )}
        </div>
      </div>
      {abierto && t.habilitado && t.items.length > 0 && (
        <div className="mt-3 grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {porMes.map(([periodo, lista]) => {
            const ids = lista.map((i) => i.id);
            const todos = ids.every((id) => sel.has(id));
            return (
              <div key={periodo} className="rounded-md border border-brand-border bg-white p-2.5">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="font-display text-base text-brand-ink uppercase">{nombrePeriodo(periodo)}</div>
                  {!porMesCompleto && lista.length > 1 && (
                    <label className="text-xs font-semibold text-brand-graphite flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={todos} onChange={() => onToggle(ids, !todos)} /> Todo el mes ({n(lista.length)})</label>
                  )}
                </div>
                <ul className={`space-y-1 ${lista.length > 8 ? "max-h-56 overflow-auto pr-1" : ""}`}>
                  {lista.map((f) => (
                    <li key={f.id}>
                      <label className={`flex items-start gap-2 rounded-md px-2 py-1 cursor-pointer text-sm ${sel.has(f.id) ? "bg-brand-primary-light/60" : "hover:bg-brand-bg"}`}>
                        <input type="checkbox" className="mt-0.5" checked={sel.has(f.id)} onChange={() => onToggle([f.id])} />
                        <span>
                          <span className="font-semibold">{f.etiqueta}</span>{" "}
                          {f.status !== "published" && <span className={badge(f.status)}>{STATUS_LABEL[f.status] ?? f.status}</span>}
                          <span className="block text-xs text-brand-slate">{detalleItem(t.tipo, f)}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
