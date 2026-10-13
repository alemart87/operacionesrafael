"use client";

import { Activity, Ban, Check, Copy, KeyRound, Plus, ShieldCheck, Trash2, TriangleAlert, Unlock } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Campo, ErrorMsg, Modal } from "@/components/supervision/dialogos";
import { apiFetch } from "@/lib/api";
import { Clave, DatasetInfo, INT_API, ListaClaves, RESULTADO, Uso, fecha, fechaHora } from "./tipos";

const n = (v: number) => v.toLocaleString("es-PY");

// ------------------------------------------------------------------ crear una clave
function DialogoCrear({ datasets, max, onClose, onCreada }: {
  datasets: DatasetInfo[]; max: ListaClaves["limites_max"]; onClose: () => void; onCreada: (c: Clave, secreto: string) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [vigencia, setVigencia] = useState(365);
  const [minuto, setMinuto] = useState(60);
  const [dia, setDia] = useState(5000);
  const [todos, setTodos] = useState(true);
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const modulos = useMemo(() => Array.from(new Set(datasets.map((d) => d.modulo))), [datasets]);

  const crear = async () => {
    setOcupado(true);
    setError(null);
    try {
      const r = await apiFetch<{ clave: Clave; secreto: string }>(`${INT_API}/claves`, {
        method: "POST",
        body: JSON.stringify({ nombre: nombre.trim(), vigencia_dias: vigencia, limite_minuto: minuto, limite_dia: dia, datasets: todos ? [] : elegidos }),
      });
      onCreada(r.clave, r.secreto);
    } catch (e: any) { setError(e.message); setOcupado(false); }
  };
  const valido = nombre.trim().length >= 2 && (todos || elegidos.length > 0);
  return (
    <Modal titulo="Nueva clave de API" sobre="Integraciones" onClose={onClose} ancho="max-w-2xl" pie={
      <>
        <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn-primary" disabled={!valido || ocupado} onClick={crear}>{ocupado ? "Creando…" : "Crear la clave"}</button>
      </>
    }>
      <div className="space-y-4">
        <Campo label="Nombre" htmlFor="k-nombre" ayuda="Para reconocerla: la herramienta y quién la usa (p. ej. «KNIME · análisis de productividad»).">
          <input id="k-nombre" className="input" maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
        </Campo>
        <div className="grid sm:grid-cols-3 gap-3">
          <Campo label="Vigencia (días)" htmlFor="k-vig" ayuda={`Hasta ${max.vigencia_dias}. Vencida, deja de servir.`}>
            <input id="k-vig" type="number" min={1} max={max.vigencia_dias} className="input tabular-nums" value={vigencia}
              onChange={(e) => setVigencia(Math.max(1, Math.min(max.vigencia_dias, Number(e.target.value) || 1)))} />
          </Campo>
          <Campo label="Límite por minuto" htmlFor="k-min" ayuda={`Llamadas por minuto (hasta ${n(max.minuto)}).`}>
            <input id="k-min" type="number" min={1} max={max.minuto} className="input tabular-nums" value={minuto}
              onChange={(e) => setMinuto(Math.max(1, Math.min(max.minuto, Number(e.target.value) || 1)))} />
          </Campo>
          <Campo label="Límite por día" htmlFor="k-dia" ayuda={`Llamadas por día de Asunción (hasta ${n(max.dia)}).`}>
            <input id="k-dia" type="number" min={1} max={max.dia} className="input tabular-nums" value={dia}
              onChange={(e) => setDia(Math.max(1, Math.min(max.dia, Number(e.target.value) || 1)))} />
          </Campo>
        </div>
        <div>
          <div className="label">Datasets que puede leer</div>
          <div className="flex gap-2 mb-2">
            <button type="button" className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${todos ? "border-brand-ink bg-brand-ink text-white" : "border-brand-border text-brand-graphite"}`} onClick={() => setTodos(true)}>Todos los del catálogo</button>
            <button type="button" className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${!todos ? "border-brand-ink bg-brand-ink text-white" : "border-brand-border text-brand-graphite"}`} onClick={() => setTodos(false)}>Solo algunos</button>
          </div>
          {!todos && (
            <div className="space-y-2">
              {modulos.map((m) => (
                <div key={m} className="rounded-md border border-brand-border p-2.5">
                  <div className="text-[11px] uppercase tracking-wider2 text-brand-slate font-semibold mb-1">{m}</div>
                  {datasets.filter((d) => d.modulo === m).map((d) => (
                    <label key={d.nombre} className="flex items-start gap-2 text-sm py-0.5 cursor-pointer">
                      <input type="checkbox" className="mt-1" checked={elegidos.includes(d.nombre)}
                        onChange={(e) => setElegidos((a) => e.target.checked ? [...a, d.nombre] : a.filter((x) => x !== d.nombre))} />
                      <span><b className="text-brand-ink">{d.titulo}</b> <code className="text-[11px] text-brand-slate">{d.nombre}</code></span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}
          <div className="text-[11px] text-brand-slate mt-1">Facturación no tiene dataset: queda afuera por diseño.</div>
        </div>
        <ErrorMsg msg={error} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ el secreto, una sola vez
function DialogoSecreto({ clave, secreto, onClose }: { clave: Clave; secreto: string; onClose: () => void }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    try { await navigator.clipboard.writeText(secreto); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { /* sin portapapeles */ }
  };
  return (
    <Modal titulo="Guardá la clave ahora" sobre={clave.nombre} onClose={onClose} acento="bg-brand-orange" pie={
      <button type="button" className="btn-primary" onClick={onClose}>Ya la guardé</button>
    }>
      <div className="space-y-3">
        <div className="rounded-md border border-brand-orange/40 bg-brand-orange/10 p-3 text-sm text-brand-graphite flex gap-2.5">
          <TriangleAlert size={18} className="text-brand-orange shrink-0 mt-0.5" aria-hidden />
          <div><b>Se muestra una sola vez.</b> La plataforma guarda solo su huella: si la perdés, creá otra y bloqueá esta.</div>
        </div>
        <div className="flex items-stretch gap-2">
          <code className="flex-1 rounded-md border border-brand-border bg-brand-bg px-3 py-2.5 text-sm break-all select-all">{secreto}</code>
          <button type="button" className="btn-secondary shrink-0" onClick={copiar} aria-label="Copiar la clave">
            {copiado ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />} {copiado ? "Copiada" : "Copiar"}
          </button>
        </div>
        <p className="text-xs text-brand-slate">
          En KNIME va en el nodo <b>GET Request</b>, pestaña Authentication → Bearer (o en el header <code>Authorization: Bearer …</code>).
          Guía completa en <Link href="/televentas-claro/integraciones/knime" className="text-brand-primary underline">Conectar KNIME</Link>.
        </p>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ usos de una clave
function PanelUsos({ clave, onClose }: { clave: Clave; onClose: () => void }) {
  const [items, setItems] = useState<Uso[] | null>(null);
  useEffect(() => {
    apiFetch<{ items: Uso[] }>(`${INT_API}/claves/${clave.id}/usos?limit=300`).then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [clave.id]);
  return (
    <Modal titulo={`Usos de ${clave.nombre}`} sobre={`${clave.prefijo}… · ${n(clave.usos)} llamadas atendidas en total`} onClose={onClose} ancho="max-w-4xl">
      {items === null ? <div className="text-sm text-brand-slate">Cargando…</div> : items.length === 0 ? (
        <div className="text-sm text-brand-slate">Todavía no se usó.</div>
      ) : (
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-[11px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
              <th className="py-1.5 pr-3">Cuándo</th><th className="py-1.5 pr-3">Dataset</th><th className="py-1.5 pr-3">Resultado</th>
              <th className="py-1.5 pr-3 text-right">Filas</th><th className="py-1.5 pr-3 text-right">ms</th><th className="py-1.5 pr-3">IP</th><th className="py-1.5">Detalle</th>
            </tr></thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id} className="border-b border-brand-border/60">
                  <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums">{fechaHora(u.at)}</td>
                  <td className="py-1.5 pr-3"><code>{u.dataset ?? "catálogo"}</code></td>
                  <td className="py-1.5 pr-3"><span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${RESULTADO[u.resultado].clase}`}>{RESULTADO[u.resultado].label} · {u.status}</span></td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{n(u.filas)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{n(u.ms)}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{u.ip ?? "—"}</td>
                  <td className="py-1.5 text-brand-slate">{u.detalle ?? (u.user_agent ? u.user_agent.slice(0, 60) : "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ la pantalla
export function ClavesView() {
  const [data, setData] = useState<ListaClaves | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [crear, setCrear] = useState(false);
  const [nueva, setNueva] = useState<{ clave: Clave; secreto: string } | null>(null);
  const [usosDe, setUsosDe] = useState<Clave | null>(null);
  const [bloquear, setBloquear] = useState<Clave | null>(null);
  const [motivo, setMotivo] = useState("");
  const [eliminar, setEliminar] = useState<Clave | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try { setData(await apiFetch<ListaClaves>(`${INT_API}/claves`)); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const accion = async (c: Clave, que: "bloquear" | "desbloquear" | "eliminar", body?: unknown) => {
    setOcupado(c.id);
    setError(null);
    try {
      if (que === "eliminar") await apiFetch(`${INT_API}/claves/${c.id}`, { method: "DELETE" });
      else await apiFetch(`${INT_API}/claves/${c.id}/${que}`, { method: "POST", body: body ? JSON.stringify(body) : undefined });
      await cargar();
    } catch (e: any) { setError(e.message); } finally { setOcupado(null); setBloquear(null); setEliminar(null); setMotivo(""); }
  };

  const titulo = (d: string) => data?.datasets.find((x) => x.nombre === d)?.titulo ?? d;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">Integraciones</div>
          <h1 className="font-display text-3xl text-brand-ink uppercase mt-1">Claves de API</h1>
          <p className="text-sm text-brand-slate mt-1 max-w-3xl">
            Para conectar KNIME, Power BI o Python a los datos ya publicados, de solo lectura. Cada clave tiene vencimiento y
            límites; cada uso queda registrado. {data?.superadmin ? "Como superadmin ves todas las claves y podés bloquearlas, desbloquearlas y eliminarlas." : "Ves tus claves y podés bloquearlas; el superadmin las desbloquea o elimina."}
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setCrear(true)}><Plus size={16} /> Nueva clave</button>
      </div>
      {error && <div className="mb-4 rounded-md border border-brand-primary/30 bg-brand-primary-light px-3 py-2.5 text-sm text-brand-primary-dark">{error}</div>}

      {data === null ? <div className="card p-10 text-brand-slate">Cargando…</div> : data.items.length === 0 ? (
        <div className="card p-10 text-center">
          <KeyRound size={28} className="mx-auto text-brand-mist" aria-hidden />
          <div className="font-display text-xl uppercase text-brand-ink mt-2">Todavía no hay claves</div>
          <p className="text-sm text-brand-slate mt-1">Creá la primera y seguí la guía <Link href="/televentas-claro/integraciones/knime" className="text-brand-primary underline">Conectar KNIME</Link>.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.items.map((c) => {
            const bloqueada = c.estado === "bloqueada";
            const inactiva = bloqueada || c.vencida;
            return (
              <article key={c.id} className={`card p-4 sm:p-5 ${inactiva ? "opacity-80" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-xl uppercase text-brand-ink leading-none">{c.nombre}</h2>
                      {bloqueada ? <span className="badge bg-brand-primary-light text-brand-primary-dark">Bloqueada</span> : c.vencida ? <span className="badge-orange">Vencida</span> : <span className="badge-success">Activa</span>}
                    </div>
                    <div className="text-xs text-brand-slate mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                      <span><code className="text-brand-graphite">{c.prefijo}…</code></span>
                      <span>de <b className="text-brand-graphite">{c.owner}</b></span>
                      <span>creada {fecha(c.created_at)}</span>
                      <span>vence {fecha(c.expira_at)}</span>
                      <span>límites <b className="text-brand-graphite tabular-nums">{n(c.limite_minuto)}/min · {n(c.limite_dia)}/día</b></span>
                    </div>
                    <div className="text-xs text-brand-slate mt-1">
                      Datasets: {c.datasets.length === 0 ? <b className="text-brand-graphite">todos</b> : c.datasets.map((d) => <code key={d} className="mr-1.5 text-brand-graphite">{titulo(d)}</code>)}
                    </div>
                    {bloqueada && c.motivo_bloqueo && <div className="text-xs text-brand-primary-dark mt-1">Motivo: {c.motivo_bloqueo}</div>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="btn-secondary" onClick={() => setUsosDe(c)}><Activity size={15} /> Usos</button>
                    {!bloqueada && <button type="button" className="btn-secondary" disabled={ocupado === c.id} onClick={() => setBloquear(c)}><Ban size={15} /> Bloquear</button>}
                    {bloqueada && data.superadmin && <button type="button" className="btn-secondary" disabled={ocupado === c.id} onClick={() => accion(c, "desbloquear")}><Unlock size={15} /> Desbloquear</button>}
                    {data.superadmin && <button type="button" className="btn-danger" disabled={ocupado === c.id} onClick={() => setEliminar(c)}><Trash2 size={15} /> Eliminar</button>}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="rounded-md bg-brand-bg px-3 py-2"><div className="text-brand-slate">Hoy</div><div className="font-display text-lg text-brand-ink tabular-nums">{n(c.usos_hoy)} <span className="text-xs font-sans text-brand-slate">llamadas</span></div></div>
                  <div className="rounded-md bg-brand-bg px-3 py-2"><div className="text-brand-slate">Rechazadas hoy</div><div className={`font-display text-lg tabular-nums ${c.rechazos_hoy ? "text-brand-primary" : "text-brand-ink"}`}>{n(c.rechazos_hoy)}</div></div>
                  <div className="rounded-md bg-brand-bg px-3 py-2"><div className="text-brand-slate">Total</div><div className="font-display text-lg text-brand-ink tabular-nums">{n(c.usos)}</div></div>
                  <div className="rounded-md bg-brand-bg px-3 py-2"><div className="text-brand-slate">Último uso</div><div className="font-semibold text-brand-ink tabular-nums">{fechaHora(c.ultimo_uso_at)}</div>{c.ultimo_ip && <div className="text-brand-slate tabular-nums">{c.ultimo_ip}</div>}</div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="mt-6 rounded-md border border-brand-border bg-white p-3.5 text-xs text-brand-slate flex gap-2.5">
        <ShieldCheck size={16} className="text-brand-cyan shrink-0 mt-0.5" aria-hidden />
        <div>Las claves son de <b>solo lectura</b> sobre lo ya publicado o firmado, nunca alcanzan a Facturación, y cada llamada (atendida o rechazada) queda en el <Link href="/televentas-claro/integraciones/usos" className="text-brand-primary underline">registro de uso</Link> y en la auditoría de la plataforma.</div>
      </div>

      {crear && data && <DialogoCrear datasets={data.datasets} max={data.limites_max} onClose={() => setCrear(false)}
        onCreada={(clave, secreto) => { setCrear(false); setNueva({ clave, secreto }); cargar(); }} />}
      {nueva && <DialogoSecreto clave={nueva.clave} secreto={nueva.secreto} onClose={() => setNueva(null)} />}
      {usosDe && <PanelUsos clave={usosDe} onClose={() => setUsosDe(null)} />}
      {bloquear && (
        <Modal titulo="Bloquear la clave" sobre={bloquear.nombre} onClose={() => setBloquear(null)} acento="bg-brand-primary" pie={
          <>
            <button type="button" className="btn-secondary" onClick={() => setBloquear(null)}>Cancelar</button>
            <button type="button" className="btn-danger" disabled={ocupado === bloquear.id} onClick={() => accion(bloquear, "bloquear", { motivo })}><Ban size={15} /> Bloquear</button>
          </>
        }>
          <p className="text-sm text-brand-graphite mb-3">Deja de servir al instante: cada intento con ella quedará registrado como denegado. {data?.superadmin ? "Podés desbloquearla después." : "Solo el superadmin la desbloquea."}</p>
          <Campo label="Motivo (opcional)" htmlFor="k-motivo"><input id="k-motivo" className="input" maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="p. ej. se filtró, la persona dejó el equipo" /></Campo>
        </Modal>
      )}
      <ConfirmDialog open={!!eliminar} title="Eliminar la clave" variant="danger" confirmLabel="Eliminar" loading={!!eliminar && ocupado === eliminar.id}
        message={eliminar ? `«${eliminar.nombre}» desaparece y deja de servir. El registro de sus usos queda para la auditoría.` : ""}
        onCancel={() => setEliminar(null)} onConfirm={() => eliminar && accion(eliminar, "eliminar")} />
    </>
  );
}
