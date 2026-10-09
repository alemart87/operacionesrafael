"use client";

import { Link2, Pencil, RefreshCw, Search, Undo2, Unlink, UserCheck, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell, useSession } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Procesando } from "@/components/Procesando";
import { fechaHora, n } from "@/components/productividad/tipos";
import {
  CRUCE, SUP_API, dm, periodoDeUrl, periodoEnUrl, type ListaOperadores, type Operador,
} from "@/components/supervision/tipos";
import { CruceChip, Identidades, SelectorMes } from "@/components/supervision/ui";
import { apiFetch } from "@/lib/api";
import { PERM_OPERADORES } from "@/lib/operativas";

export default function OperadoresPage() {
  return (
    <AppShell>
      <Maestro />
    </AppShell>
  );
}

type Filtro = "por_revisar" | "todos" | "vinculados" | "solo_llamadas" | "solo_ventas" | "inactivos";
const FILTROS: { key: Filtro; label: string }[] = [
  { key: "por_revisar", label: "Por revisar" },
  { key: "todos", label: "Todos" },
  { key: "vinculados", label: "Vinculados" },
  { key: "solo_llamadas", label: "Solo llamadas" },
  { key: "solo_ventas", label: "Solo ventas" },
  { key: "inactivos", label: "De baja" },
];

function filtra(o: Operador, f: Filtro): boolean {
  switch (f) {
    case "por_revisar": return !!CRUCE[o.cruce].pendiente && o.activo;
    case "vinculados": return !!o.agente && !!o.vendedor;
    case "solo_llamadas": return !!o.agente && !o.vendedor;
    case "solo_ventas": return !!o.vendedor && !o.agente;
    case "inactivos": return !o.activo;
    default: return true;
  }
}

function Maestro() {
  const { can } = useSession();
  const gestion = can(PERM_OPERADORES);
  const [periodo, setPeriodo] = useState(periodoDeUrl);
  const [data, setData] = useState<ListaOperadores | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro | null>(null);
  const [delMes, setDelMes] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [vincular, setVincular] = useState<Operador | null>(null);
  const [renombrar, setRenombrar] = useState<Operador | null>(null);
  const [confirmar, setConfirmar] = useState<{ titulo: string; mensaje: string; accion: () => Promise<unknown> } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [detectando, setDetectando] = useState(false);

  const load = useCallback(async (p: string) => {
    setError(null);
    try {
      const d = await apiFetch<ListaOperadores>(`${SUP_API}/operadores?periodo=${p}`);
      setData(d);
      setFiltro((f) => f ?? (d.resumen.por_revisar ? "por_revisar" : "todos"));
    } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { setData(null); setOk(null); load(periodo); periodoEnUrl(periodo); }, [periodo, load]);

  const accion = async (fn: () => Promise<unknown>, mensaje: string) => {
    setOcupado(true);
    setError(null);
    try { await fn(); setOk(mensaje); await load(periodo); } catch (e: any) { setError(e.message); } finally { setOcupado(false); setConfirmar(null); }
  };
  const post = (o: Operador, que: string, body?: object) =>
    apiFetch(`${SUP_API}/operadores/${o.id}/${que}`, { method: "POST", body: body ? JSON.stringify(body) : undefined });

  const detectar = async () => {
    setDetectando(true);
    setError(null);
    try {
      const r = await apiFetch<{ nuevos: number; unidos: number }>(`${SUP_API}/operadores/detectar`, { method: "POST", body: JSON.stringify({ periodo }) });
      setOk(`Detección de ${data?.nombre_mes.toLowerCase()} rehecha: ${r.nuevos} nombre(s) nuevo(s), ${r.unidos} unido(s) por nombre.`);
      await load(periodo);
    } catch (e: any) { setError(e.message); } finally { setDetectando(false); }
  };

  const items = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (data?.items ?? []).filter((o) =>
      (!delMes || o.del_mes || filtro === "inactivos") && filtra(o, filtro ?? "todos") &&
      (!q || [o.nombre, o.agente, o.vendedor, o.legajo].some((x) => x?.toLowerCase().includes(q))));
  }, [data, filtro, delMes, busqueda]);
  const conteo = useMemo(() => Object.fromEntries(FILTROS.map((f) => [f.key, (data?.items ?? []).filter((o) =>
    (!delMes || o.del_mes || f.key === "inactivos") && filtra(o, f.key)).length])), [data, delMes]);

  const det = data?.deteccion;
  return (
    <>
      <Procesando abierto={detectando} titulo="Detectando operadores" detalle="Leyendo los informes de Productividad y Ventas Netas del mes y cruzando los nombres." />
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Supervisión</div>
          <h1 className="font-display text-4xl text-brand-ink uppercase leading-tight">Operadores</h1>
          <p className="text-sm text-brand-slate mt-2 max-w-3xl">
            Cada asesor tiene un nombre en la plataforma de llamadas y otro como vendedor en Ventas Netas, sin un ID común. El sistema
            los detecta en cada carga y los une por nombre; lo que no coincide se vincula acá. Vale para Supervisión y para el SPH.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SelectorMes periodo={periodo} onChange={setPeriodo} />
          {gestion && <button type="button" className="btn-secondary" onClick={detectar} disabled={detectando || !data}><RefreshCw size={15} /> Detectar de nuevo</button>}
        </div>
      </div>

      {error && <div className="card p-4 text-sm text-brand-primary mb-4">{error}</div>}
      {ok && <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-md px-3 py-2.5">{ok}</div>}

      {!data || !det ? (
        !error && <div className="card p-10 text-brand-slate">Cargando…</div>
      ) : (
        <div className="space-y-5">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Dato titulo="En llamadas" valor={det.agentes} detalle={`${n(det.dias_productividad)} día(s) de Productividad en ${data.nombre_mes.toLowerCase()}`} />
            <Dato titulo="En ventas" valor={det.vendedores} detalle={det.ventas ? `Ventas Netas al ${dm(det.ventas.fecha_dato)}` : "Sin informe de Ventas Netas del mes"} />
            <Dato titulo="Vinculados" valor={det.vinculados} detalle={`de ${n(det.operadores_del_mes)} operadores con actividad en el mes`} />
            <Dato titulo="Por revisar" valor={det.por_revisar} detalle="Sin su otro nombre: vincular o confirmar" alerta={det.por_revisar > 0} />
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar">
              {FILTROS.map((f) => (
                <button key={f.key} type="button" onClick={() => setFiltro(f.key)} aria-pressed={filtro === f.key}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${filtro === f.key ? "bg-brand-ink text-white border-brand-ink" : "bg-white text-brand-slate border-brand-border hover:border-brand-ink"}`}>
                  {f.label}<span className={`ml-1.5 tabular-nums ${filtro === f.key ? "text-white/70" : "opacity-70"}`}>{conteo[f.key]}</span>
                </button>
              ))}
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-brand-slate">
              <input type="checkbox" className="w-4 h-4 accent-brand-primary" checked={delMes} onChange={(e) => setDelMes(e.target.checked)} />
              Solo con actividad en {data.nombre_mes.toLowerCase()}
            </label>
            <label className="relative flex-1 min-w-[220px] max-w-sm ml-auto">
              <span className="sr-only">Buscar</span>
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-mist" aria-hidden />
              <input className="input pl-9" placeholder="Buscar nombre o legajo" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            </label>
          </div>

          <section className="card min-w-0">
            {!items.length ? (
              <p className="p-8 text-center text-sm text-brand-slate">{filtro === "por_revisar" ? "No hay nombres por revisar: todos están vinculados o confirmados." : "No hay operadores con ese filtro."}</p>
            ) : (
              <ul className="divide-y divide-brand-border">
                {items.map((o) => (
                  <li key={o.id} className={`px-5 py-3 flex items-start gap-4 flex-wrap ${!o.activo ? "bg-brand-bg-soft" : ""}`}>
                    <div className="min-w-0 flex-1 basis-72">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-semibold ${o.activo ? "text-brand-ink" : "text-brand-slate"}`}>{o.nombre}</span>
                        <CruceChip cruce={o.cruce} />
                        {!o.activo && <span className="badge-neutral">De baja</span>}
                        {o.legajo && <span className="text-[10px] text-brand-mist">Legajo {o.legajo}</span>}
                      </div>
                      <Identidades agente={o.agente} vendedor={o.vendedor} subcanal={o.subcanal} />
                      {!!o.sugeridos.length && gestion && (
                        <div className="text-[11px] text-brand-slate mt-1">
                          Parecido a: {o.sugeridos.slice(0, 3).map((s) => s.identidad).join(" · ")}
                        </div>
                      )}
                      <div className="text-[10px] text-brand-mist mt-0.5">
                        Visto {o.primera_vez ? `del ${dm(o.primera_vez)} al ${dm(o.ultima_vez)}` : "—"}
                        {o.updated_by && ` · último cambio: ${o.updated_by}, ${fechaHora(o.updated_at)}`}
                      </div>
                    </div>
                    {gestion && (
                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        {CRUCE[o.cruce].pendiente && (
                          <>
                            <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setVincular(o)}><Link2 size={13} /> Vincular</button>
                            <button type="button" className="btn-ghost text-xs" disabled={ocupado}
                              onClick={() => accion(() => post(o, "confirmar"), `${o.nombre}: ${o.agente ? "confirmado que no vende" : "confirmado que solo vende"}.`)}>
                              <UserCheck size={13} /> {o.agente ? "No vende" : "Solo ventas"}
                            </button>
                          </>
                        )}
                        {o.cruce === "probable" && (
                          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" disabled={ocupado}
                            onClick={() => accion(() => post(o, "confirmar"), `${o.nombre}: vínculo confirmado.`)}><UserCheck size={13} /> Confirmar</button>
                        )}
                        {o.agente && o.vendedor && (
                          <button type="button" className="btn-ghost text-xs" onClick={() => setConfirmar({
                            titulo: "Separar el vínculo",
                            mensaje: `${o.agente} deja de ser ${o.vendedor}. El vendedor queda como un operador aparte y el cruce automático no los vuelve a unir; los equipos siguen con el nombre de llamadas.`,
                            accion: () => post(o, "separar"),
                          })}><Unlink size={13} /> Separar</button>
                        )}
                        {(o.cruce === "manual" || o.cruce === "descartado" || o.cruce === "solo_ventas") && (
                          <button type="button" className="btn-ghost text-xs" disabled={ocupado} title="Deshace lo decidido a mano y vuelve al cruce por nombre"
                            onClick={() => accion(() => post(o, "automatico"), `${o.nombre}: volvió al cruce automático.`)}><Undo2 size={13} /> Automático</button>
                        )}
                        <button type="button" className="btn-ghost text-xs" onClick={() => setRenombrar(o)} aria-label={`Renombrar ${o.nombre}`}><Pencil size={13} /></button>
                        <button type="button" className="btn-ghost text-xs" disabled={ocupado}
                          onClick={() => accion(() => apiFetch(`${SUP_API}/operadores/${o.id}`, { method: "PATCH", body: JSON.stringify({ activo: !o.activo }) }),
                            `${o.nombre}: ${o.activo ? "dado de baja" : "reactivado"}.`)}>
                          {o.activo ? "Dar de baja" : "Reactivar"}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="text-xs text-brand-slate">
            <b>Exacto</b>: están todas las palabras del nombre de llamadas en el del vendedor. <b>Probable</b>: coinciden el nombre y un apellido
            pero falta alguna palabra o cambia la escritura (conviene confirmarlo). Lo que decide una persona no lo cambia el cruce automático.
            Dar de baja no borra la historia: el operador deja de proponerse para los equipos.
          </p>
        </div>
      )}

      {vincular && data && (
        <VincularDialog o={vincular} todos={data.items} onClose={() => setVincular(null)}
          onVincular={(con) => accion(() => post(vincular, "vincular", { con: con.id }), `${vincular.nombre} quedó vinculado con ${con.nombre}.`).then(() => setVincular(null))} />
      )}
      {renombrar && (
        <RenombrarDialog o={renombrar} onClose={() => setRenombrar(null)}
          onGuardar={(nombre) => accion(() => apiFetch(`${SUP_API}/operadores/${renombrar.id}`, { method: "PATCH", body: JSON.stringify({ nombre }) }),
            `Renombrado a «${nombre}».`).then(() => setRenombrar(null))} />
      )}
      <ConfirmDialog open={!!confirmar} title={confirmar?.titulo ?? ""} message={confirmar?.mensaje} confirmLabel="Separar" variant="danger"
        loading={ocupado} onCancel={() => setConfirmar(null)}
        onConfirm={() => confirmar && accion(confirmar.accion, "Vínculo separado.")} />
    </>
  );
}

function Dato({ titulo, valor, detalle, alerta }: { titulo: string; valor: number; detalle: string; alerta?: boolean }) {
  return (
    <div className={`card p-4 border-l-[3px] ${alerta ? "border-l-brand-orange" : "border-l-brand-cyan"}`}>
      <div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate">{titulo}</div>
      <div className="font-display text-3xl text-brand-ink tabular-nums mt-1">{n(valor)}</div>
      <div className="text-[11px] text-brand-slate mt-0.5">{detalle}</div>
    </div>
  );
}

/** Elegir el otro nombre de la persona: sugeridos primero, después cualquiera del otro lado. */
function VincularDialog({ o, todos, onClose, onVincular }: { o: Operador; todos: Operador[]; onClose: () => void; onVincular: (con: Operador) => void }) {
  const [q, setQ] = useState("");
  const [elegido, setElegido] = useState<string | null>(null);
  const buscaVendedor = !!o.agente && !o.vendedor;
  const opciones = useMemo(() => {
    const otros = todos.filter((x) => x.id !== o.id && x.activo && (buscaVendedor ? x.vendedor && !x.agente : x.agente && !x.vendedor));
    const sugeridos = new Set(o.sugeridos.map((s) => s.id).filter(Boolean));
    const t = q.trim().toLowerCase();
    return otros
      .filter((x) => !t || [x.nombre, x.agente, x.vendedor].some((y) => y?.toLowerCase().includes(t)))
      .sort((a, b) => Number(sugeridos.has(b.id)) - Number(sugeridos.has(a.id)) || a.nombre.localeCompare(b.nombre))
      .map((x) => ({ x, sugerido: sugeridos.has(x.id) }));
  }, [todos, o, q, buscaVendedor]);
  const sel = opciones.find((x) => x.x.id === elegido)?.x;

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-brand-ink/50 backdrop-blur-[2px] animate-fade" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Vincular" className="relative w-full max-w-lg card shadow-elevated max-h-[88vh] flex flex-col animate-pop">
        <div className="h-1.5 bg-brand-cyan rounded-t-lg" />
        <div className="p-5 border-b border-brand-border flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">{buscaVendedor ? "¿Qué vendedor es?" : "¿Qué nombre de llamadas tiene?"}</div>
            <h2 className="font-display text-2xl text-brand-ink uppercase leading-tight">{o.nombre}</h2>
            <Identidades agente={o.agente} vendedor={o.vendedor} subcanal={o.subcanal} />
          </div>
          <button type="button" onClick={onClose} className="btn-ghost" aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div className="p-5 pb-3">
          <label className="relative block">
            <span className="sr-only">Buscar</span>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-mist" aria-hidden />
            <input autoFocus className="input pl-9" placeholder={buscaVendedor ? "Buscar vendedor" : "Buscar nombre de llamadas"} value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
        <ul className="overflow-y-auto px-5 pb-3 space-y-1.5 flex-1" role="radiogroup">
          {!opciones.length && <li className="text-sm text-brand-slate py-4">No hay {buscaVendedor ? "vendedores" : "nombres de llamadas"} sin vincular con esa búsqueda.</li>}
          {opciones.map(({ x, sugerido }) => (
            <li key={x.id}>
              <button type="button" role="radio" aria-checked={elegido === x.id} onClick={() => setElegido(x.id)}
                className={`w-full text-left rounded-md border px-3 py-2 transition-colors ${elegido === x.id ? "border-brand-primary bg-brand-primary-light/60" : "border-brand-border hover:border-brand-slate"}`}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-brand-ink">{buscaVendedor ? x.vendedor : x.agente}</span>
                  {sugerido && <span className="badge-cyan">Parecido</span>}
                </div>
                <div className="text-[11px] text-brand-slate">
                  {x.subcanal ? `${x.subcanal} · ` : ""}visto {x.primera_vez ? `del ${dm(x.primera_vez)} al ${dm(x.ultima_vez)}` : "—"}
                </div>
              </button>
            </li>
          ))}
        </ul>
        <div className="p-5 pt-3 border-t border-brand-border flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn-primary" disabled={!sel} onClick={() => sel && onVincular(sel)}><Link2 size={15} /> Vincular</button>
        </div>
      </div>
    </div>
  );
}

function RenombrarDialog({ o, onClose, onGuardar }: { o: Operador; onClose: () => void; onGuardar: (nombre: string) => void }) {
  const [nombre, setNombre] = useState(o.nombre);
  const valido = nombre.trim().length >= 2 && nombre.trim() !== o.nombre;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-brand-ink/50 backdrop-blur-[2px] animate-fade" onClick={onClose} />
      <form role="dialog" aria-modal="true" aria-label="Renombrar" className="relative w-full max-w-md card shadow-elevated animate-pop"
        onSubmit={(e) => { e.preventDefault(); if (valido) onGuardar(nombre.trim()); }}>
        <div className="h-1.5 bg-brand-cyan rounded-t-lg" />
        <div className="p-6">
          <h2 className="font-display text-2xl text-brand-ink uppercase leading-tight">Renombrar</h2>
          <p className="text-xs text-brand-slate mt-1">Cómo se muestra en Supervisión. No cambia los nombres de origen (llamadas y ventas).</p>
          <input autoFocus className="input mt-4" maxLength={200} value={nombre} onChange={(e) => setNombre(e.target.value)} aria-label="Nombre" />
          <div className="flex justify-end gap-2 mt-5">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={!valido}>Guardar</button>
          </div>
        </div>
      </form>
    </div>
  );
}
