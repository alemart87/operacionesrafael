"use client";

import {
  AlertTriangle, CheckCircle2, CloudUpload, Gauge, Loader2, MessagesSquare, PlugZap, Save, Users, Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiFetch } from "@/lib/api";
import { VOI_API } from "@/lib/voi";
import { ConfigVoi, ConsumoVoi, ESFUERZOS, EsfuerzoVoi, EstadoAdminVoi, NIVEL, num, usd } from "./tipos";

function Kpi({ icono, titulo, valor, detalle, tono, children }: {
  icono: React.ReactNode; titulo: string; valor: React.ReactNode; detalle?: React.ReactNode; tono: string; children?: React.ReactNode;
}) {
  return (
    <div className="card p-4 min-w-0">
      <div className="flex items-start gap-3">
        <span className={`hidden sm:grid place-items-center w-10 h-10 rounded-lg shrink-0 ${tono}`}>{icono}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider2 text-brand-slate font-semibold">{titulo}</div>
          <div className="font-display text-2xl text-brand-ink leading-tight tabular-nums">{valor}</div>
          {detalle && <div className="text-[11px] text-brand-slate truncate">{detalle}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

function Fila({ ok, titulo, children }: { ok: boolean | null; titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-t border-brand-border first:border-t-0">
      {ok === null ? <span className="w-4 h-4 rounded-full bg-brand-border mt-0.5 shrink-0" /> :
        ok ? <CheckCircle2 size={16} className="text-emerald-600 mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="text-brand-orange mt-0.5 shrink-0" />}
      <div className="min-w-0">
        <div className="text-sm font-semibold text-brand-ink">{titulo}</div>
        <div className="text-xs text-brand-slate mt-0.5 break-words">{children}</div>
      </div>
    </div>
  );
}

function CampoNumero({ label, valor, onChange, sufijo, paso = 1, min = 0, ayuda }: {
  label: string; valor: number; onChange: (v: number) => void; sufijo?: string; paso?: number; min?: number; ayuda?: string;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="relative">
        <input type="number" className="input pr-14 tabular-nums" value={Number.isFinite(valor) ? valor : ""} step={paso} min={min}
          onChange={(e) => onChange(parseFloat(e.target.value))} />
        {sufijo && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-brand-mist">{sufijo}</span>}
      </div>
      {ayuda && <span className="block mt-1 text-[11px] text-brand-mist leading-snug">{ayuda}</span>}
    </label>
  );
}

function Interruptor({ activo, onChange, titulo, detalle }: { activo: boolean; onChange: (v: boolean) => void; titulo: string; detalle: string }) {
  return (
    <button type="button" onClick={() => onChange(!activo)} className="w-full flex items-start gap-3 text-left" role="switch" aria-checked={activo}>
      <span className={`mt-0.5 w-10 h-6 rounded-full p-0.5 transition-colors shrink-0 ${activo ? "bg-emerald-500" : "bg-brand-border"}`}>
        <span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${activo ? "translate-x-4" : ""}`} />
      </span>
      <span>
        <span className="block text-sm font-semibold text-brand-ink">{titulo}</span>
        <span className="block text-xs text-brand-slate mt-0.5">{detalle}</span>
      </span>
    </button>
  );
}

export function TabResumen({ estado, onCambio }: { estado: EstadoAdminVoi; onCambio: () => void }) {
  const [consumo, setConsumo] = useState<ConsumoVoi | null>(null);
  const [cfg, setCfg] = useState<ConfigVoi>(estado.config);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  useEffect(() => setCfg(estado.config), [estado.config]);
  useEffect(() => {
    apiFetch<ConsumoVoi>(`${VOI_API}/admin/consumo`).then(setConsumo).catch(() => setConsumo(null));
  }, [estado]);

  const esfuerzo: EsfuerzoVoi = cfg.modelo?.esfuerzo ?? "medium";
  const sucio = JSON.stringify(cfg) !== JSON.stringify(estado.config);
  const pct = estado.tope_mes_usd ? Math.min(100, (estado.gasto_mes_usd / estado.tope_mes_usd) * 100) : 0;

  const accion = async (k: string, fn: () => Promise<string>) => {
    setOcupado(k);
    setMsg(null);
    try { setMsg({ tipo: "ok", texto: await fn() }); onCambio(); } catch (e: any) { setMsg({ tipo: "error", texto: e.message }); }
    setOcupado(null);
  };
  const publicar = (forzar = false) => accion("publicar", async () => {
    const r = await apiFetch<{ cambios: string[] }>(`${VOI_API}/admin/publicar`, { method: "POST", body: JSON.stringify({ forzar }) });
    return r.cambios.length ? `Publicado: ${r.cambios.join(", ")}.` : "Ya estaba al día: no hubo cambios para publicar.";
  });
  const probar = () => accion("probar", async () => {
    const r = await apiFetch<{ ok: boolean; mensaje: string; latencia_ms?: number }>(`${VOI_API}/admin/probar`, { method: "POST" });
    if (!r.ok) throw new Error(r.mensaje);
    return `${r.mensaje}${r.latencia_ms !== undefined ? ` (${r.latencia_ms} ms)` : ""}.`;
  });
  const guardar = () => accion("guardar", async () => {
    await apiFetch(`${VOI_API}/admin/config`, {
      method: "PUT",
      body: JSON.stringify({ habilitado: cfg.habilitado, topes: cfg.topes, autonomia: cfg.autonomia, modelo: { esfuerzo } }),
    });
    return "Configuración guardada: rige desde el próximo mensaje.";
  });
  const setTope = (k: keyof ConfigVoi["topes"], v: number) => setCfg((c) => ({ ...c, topes: { ...c.topes, [k]: v } }));

  const dias = useMemo(() => (consumo?.por_dia ?? []).map((d) => ({ ...d, dia: d.fecha.slice(8, 10) })), [consumo]);
  const ag = estado.agente;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icono={<Wallet size={20} />} tono={estado.alerta_consumo ? "bg-brand-primary-light text-brand-primary" : "bg-emerald-50 text-emerald-600"}
          titulo="Gasto del mes" valor={usd(estado.gasto_mes_usd)} detalle={`de ${usd(estado.tope_mes_usd, 0)} · precio de lista`}>
          <div className="mt-3 h-1.5 rounded-full bg-brand-bg overflow-hidden" title={`${pct.toFixed(0)}% del presupuesto`}>
            <div className={`h-full rounded-full ${estado.alerta_consumo ? "bg-brand-primary" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
          </div>
        </Kpi>
        <Kpi icono={<MessagesSquare size={20} />} tono="bg-brand-cyan/10 text-brand-cyan" titulo="Conversaciones"
          valor={consumo ? num(consumo.conversaciones) : "—"} detalle={consumo ? `${num(consumo.totales.mensajes)} mensajes este mes` : undefined} />
        <Kpi icono={<Users size={20} />} tono="bg-brand-purple/10 text-brand-purple" titulo="Usuarios"
          valor={consumo ? num(consumo.totales.usuarios) : "—"} detalle="usaron a Voi este mes" />
        <Kpi icono={<Gauge size={20} />} tono="bg-brand-orange/10 text-brand-orange" titulo="Herramientas"
          valor={consumo ? num(consumo.totales.herramientas) : "—"} detalle={consumo ? `${num(consumo.totales.acciones)} acciones` : undefined} />
      </div>
      {estado.alerta_consumo && (
        <div className="rounded-lg border border-brand-primary/30 bg-brand-primary-light/50 px-4 py-3 text-sm text-brand-primary-dark flex items-center gap-2">
          <AlertTriangle size={16} /> El gasto del mes superó el {estado.config.topes.alerta_pct}% del presupuesto. Al llegar al tope, Voi se pausa para todos menos el superadmin.
        </div>
      )}
      {msg && (
        <div className={`rounded-lg px-4 py-3 text-sm ${msg.tipo === "ok" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-brand-primary-light text-brand-primary-dark border border-brand-primary/30"}`}>
          {msg.texto}
        </div>
      )}

      <div className="grid lg:grid-cols-5 gap-6">
        <section className="card p-5 lg:col-span-2">
          <h2 className="font-display text-xl text-brand-ink uppercase flex items-center gap-2"><PlugZap size={18} className="text-brand-primary" /> Conexión y agente</h2>
          <div className="mt-3">
            <Fila ok={estado.conectado} titulo={estado.simulador ? "Simulador (pruebas)" : estado.clave ? "Clave de Anthropic cargada" : "Falta la clave de Anthropic"}>
              {estado.simulador ? "Responde un motor de prueba, sin llamar a Anthropic." :
                estado.clave ? "La clave vive solo en el servidor." : <>Cargala en Render → Environment como <code className="font-mono">ANTHROPIC_API_KEY</code> y reiniciá el servicio.</>}
            </Fila>
            <Fila ok={estado.publicado ? !estado.desactualizado : false} titulo={estado.publicado ? `Agente publicado · versión ${ag?.version ?? "—"}` : "Agente sin publicar"}>
              {estado.publicado
                ? <>{estado.desactualizado ? "Hay cambios en la definición sin publicar. " : "Al día con la definición del repositorio. "}
                  {ag?.publicado_at && `Publicado el ${new Date(ag.publicado_at).toLocaleString("es-PY")}.`}</>
                : "Se publica solo al arrancar si hay clave, o con el botón."}
            </Fila>
            <Fila ok={null} titulo={`Modelo: ${estado.modelo.id}`}>
              Claude Managed Agents · razonamiento {ESFUERZOS.find((e) => e.k === (estado.config.modelo?.esfuerzo ?? "medium"))?.nombre.toLowerCase()} · contenedor sin internet.
            </Fila>
            <Fila ok={estado.webhook ? true : null} titulo={estado.webhook ? "Webhook de Anthropic activo" : "Webhook (opcional)"}>
              {estado.webhook ? "Las sesiones avisan cuando terminan o esperan una acción." :
                <>Opcional: registralo en la consola de Anthropic hacia <code className="font-mono">/api/v1/asistente/webhooks/anthropic</code> y cargá <code className="font-mono">ANTHROPIC_WEBHOOK_SIGNING_KEY</code>.</>}
            </Fila>
            <Fila ok={null} titulo={`${estado.consumidores_activos} conversación(es) trabajando ahora`}>El servidor escucha cada sesión mientras trabaja.</Fila>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-primary text-sm" disabled={!estado.conectado || !!ocupado} onClick={() => publicar(false)}>
              {ocupado === "publicar" ? <Loader2 size={15} className="animate-spin" /> : <CloudUpload size={15} />} Publicar agente
            </button>
            <button className="btn-secondary text-sm" disabled={!estado.conectado || !!ocupado} onClick={probar}>
              {ocupado === "probar" ? <Loader2 size={15} className="animate-spin" /> : <PlugZap size={15} />} Probar conexión
            </button>
            {estado.publicado && (
              <button className="btn-ghost text-xs" disabled={!estado.conectado || !!ocupado} onClick={() => publicar(true)} title="Crea una versión nueva aunque no haya cambios">
                Forzar versión nueva
              </button>
            )}
          </div>
        </section>

        <section className="card p-5 lg:col-span-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-display text-xl text-brand-ink uppercase">Gasto por día</h2>
            <span className="text-xs text-brand-slate">{consumo ? `${consumo.desde.slice(8, 10)}/${consumo.desde.slice(5, 7)} al ${consumo.hasta.slice(8, 10)}/${consumo.hasta.slice(5, 7)}` : ""}</span>
          </div>
          <div className="h-56 mt-3">
            {dias.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dias} margin={{ top: 8, right: 8, bottom: 0, left: 4 }} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke="#EEF0F4" />
                  <XAxis dataKey="dia" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#5B6275" }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#5B6275" }} width={56}
                    tickFormatter={(v) => `$${Number(v).toLocaleString("es-PY", { maximumFractionDigits: 2 })}`} />
                  <Tooltip
                    cursor={{ fill: "rgba(15,17,22,0.04)" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload as ConsumoVoi["por_dia"][number];
                      return (
                        <div className="rounded-lg border border-brand-border bg-white px-3 py-2 shadow-elevated text-xs">
                          <div className="font-semibold text-brand-ink">{d.fecha.split("-").reverse().join("/")}</div>
                          <div className="text-brand-graphite tabular-nums">{usd(d.costo_usd)}</div>
                          <div className="text-brand-slate">{d.mensajes} mensajes · {d.usuarios} usuario(s)</div>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="costo_usd" fill="#E6332A" radius={[4, 4, 0, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full grid place-items-center text-sm text-brand-mist">Todavía no hay consumo este mes.</div>
            )}
          </div>
        </section>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="card p-5 overflow-hidden">
          <h2 className="font-display text-xl text-brand-ink uppercase">Por usuario</h2>
          <div className="mt-3 overflow-x-auto -mx-5">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10px] uppercase tracking-wider2 text-brand-slate">
                <th className="px-5 py-2 font-semibold">Usuario</th><th className="px-2 py-2 font-semibold text-right">Mensajes</th>
                <th className="px-2 py-2 font-semibold text-right">Acciones</th><th className="px-5 py-2 font-semibold text-right">Gasto</th>
              </tr></thead>
              <tbody>
                {(consumo?.por_usuario ?? []).map((u) => (
                  <tr key={u.user_id} className="border-t border-brand-border">
                    <td className="px-5 py-2"><div className="font-medium text-brand-ink">{u.nombre}</div><div className="text-[11px] text-brand-slate">{u.perfil_nombre}</div></td>
                    <td className="px-2 py-2 text-right tabular-nums">{num(u.mensajes)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{num(u.acciones)}</td>
                    <td className="px-5 py-2 text-right tabular-nums font-semibold">{usd(u.costo_usd)}</td>
                  </tr>
                ))}
                {!consumo?.por_usuario.length && <tr><td colSpan={4} className="px-5 py-6 text-center text-brand-mist">Sin uso en el período.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card p-5 overflow-hidden">
          <h2 className="font-display text-xl text-brand-ink uppercase">De qué se habla</h2>
          <p className="text-xs text-brand-slate">Herramientas que Voi usó: qué módulos se consultan y qué acciones se piden.</p>
          <ul className="mt-3 space-y-2">
            {(consumo?.por_herramienta ?? []).map((h) => {
              const max = Math.max(...(consumo?.por_herramienta ?? []).map((x) => x.usos), 1);
              return (
                <li key={h.nombre}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-brand-graphite truncate">{h.etiqueta}{h.nivel && h.nivel > 1 && <span className="ml-1.5 badge-orange">{NIVEL[h.nivel]}</span>}</span>
                    <span className="tabular-nums text-brand-ink font-semibold">{num(h.usos)}{h.errores ? <span className="text-brand-orange font-normal"> · {h.errores} con error</span> : null}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-brand-bg overflow-hidden">
                    <div className="h-full rounded-full bg-brand-cyan" style={{ width: `${(h.usos / max) * 100}%` }} />
                  </div>
                </li>
              );
            })}
            {!consumo?.por_herramienta.length && <li className="py-4 text-center text-sm text-brand-mist">Sin uso en el período.</li>}
          </ul>
        </section>
      </div>

      <section className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-xl text-brand-ink uppercase">Configuración y topes</h2>
          {sucio && <span className="text-xs text-brand-primary font-semibold">Cambios sin guardar</span>}
        </div>
        <div className="mt-4 grid md:grid-cols-2 gap-5">
          <Interruptor activo={cfg.habilitado} onChange={(v) => setCfg((c) => ({ ...c, habilitado: v }))} titulo="Voi encendido"
            detalle="Apagado, nadie puede usarlo salvo el superadmin. Quién lo tiene lo decide la utilidad «Asistente IA» de cada perfil." />
          <Interruptor activo={!cfg.autonomia.borradores_sin_confirmar}
            onChange={(v) => setCfg((c) => ({ ...c, autonomia: { borradores_sin_confirmar: !v } }))}
            titulo="Confirmar también los borradores propios"
            detalle="Por defecto Voi prepara borradores (como el informe diario) sin preguntar y pide confirmación para todo lo que afecta a otros." />
        </div>
        <div className="mt-5">
          <span className="label">Razonamiento de Voi</span>
          <div className="grid sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Razonamiento de Voi">
            {ESFUERZOS.map((e) => (
              <button key={e.k} type="button" role="radio" aria-checked={esfuerzo === e.k}
                onClick={() => setCfg((c) => ({ ...c, modelo: { esfuerzo: e.k } }))}
                className={`text-left rounded-xl border px-3.5 py-2.5 transition-colors ${esfuerzo === e.k
                  ? "border-brand-primary bg-brand-primary-light/60 ring-1 ring-brand-primary/30" : "border-brand-border hover:bg-brand-bg-soft"}`}>
                <span className="flex items-center gap-2 text-sm font-semibold text-brand-ink">
                  <span className={`w-3.5 h-3.5 rounded-full border-2 ${esfuerzo === e.k ? "border-brand-primary bg-brand-primary" : "border-brand-mist"}`} />
                  {e.nombre}
                </span>
                <span className="block text-[11px] text-brand-slate mt-0.5 leading-snug">{e.detalle}</span>
              </button>
            ))}
          </div>
          <span className="block mt-1 text-[11px] text-brand-mist">Vale para las conversaciones nuevas; las abiertas siguen como empezaron.</span>
        </div>
        <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <CampoNumero label="Presupuesto del mes" sufijo="US$" valor={cfg.topes.mensual_usd} onChange={(v) => setTope("mensual_usd", v)} ayuda="Toda la plataforma." />
          <CampoNumero label="Aviso al" sufijo="%" valor={cfg.topes.alerta_pct} min={1} onChange={(v) => setTope("alerta_pct", v)} ayuda="Del presupuesto." />
          <CampoNumero label="Por conversación" sufijo="US$" paso={0.1} min={0.05} valor={cfg.topes.conversacion_usd} onChange={(v) => setTope("conversacion_usd", v)} ayuda="Tope duro que aplica Anthropic." />
          <CampoNumero label="Por usuario y día" sufijo="US$" paso={0.5} valor={cfg.topes.usuario_dia_usd} onChange={(v) => setTope("usuario_dia_usd", v)} ayuda="El superadmin no tiene." />
          <CampoNumero label="Mensajes por minuto" valor={cfg.topes.mensajes_minuto} min={1} onChange={(v) => setTope("mensajes_minuto", v)} ayuda="Por usuario." />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary text-sm" disabled={!sucio || !!ocupado} onClick={() => setCfg(estado.config)}>Descartar</button>
          <button className="btn-primary text-sm" disabled={!sucio || !!ocupado} onClick={guardar}>
            {ocupado === "guardar" ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar
          </button>
        </div>
      </section>
    </div>
  );
}
