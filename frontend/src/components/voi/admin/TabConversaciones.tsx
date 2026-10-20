"use client";

import { ChevronDown, ChevronRight, EyeOff, Loader2, Search, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, ROLE_LABELS } from "@/lib/api";
import { ItemVoi, TranscripcionVoi, VOI_API, cuando } from "@/lib/voi";
import { TarjetaAccion, VoiMarkdown } from "../VoiMensajes";
import { PiezaLienzo } from "../lienzo/VoiLienzo";
import { VoiIsotipo } from "../VoiIsotipo";
import { ConversacionAdminVoi, ESTADO_CONV, num, usd } from "./tipos";

function Detalle({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="mt-1">
      <button type="button" onClick={() => setAbierto(!abierto)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-slate hover:text-brand-ink">
        {abierto ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {titulo}
      </button>
      {abierto && <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-brand-bg p-2.5 text-[11px] leading-snug whitespace-pre-wrap break-words">{children}</pre>}
    </div>
  );
}

function ItemAdmin({ it }: { it: ItemVoi }) {
  switch (it.tipo) {
    case "usuario":
      return <div className="flex justify-end"><div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-ink text-white px-3.5 py-2 text-sm whitespace-pre-wrap">{it.texto}</div></div>;
    case "voi":
      return <div className="flex gap-2.5"><VoiIsotipo size={18} className="mt-0.5" /><div className="min-w-0 flex-1"><VoiMarkdown texto={it.texto} /></div></div>;
    case "contexto":
      return <Detalle titulo="Contexto que recibió Voi">{it.texto}</Detalle>;
    case "pensando":
      return <div className="text-[11px] text-brand-mist pl-7">· pensó</div>;
    case "paso":
      return (
        <div className="ml-7 border-l-2 border-brand-border pl-3 text-xs">
          <span className={it.estado === "error" ? "text-brand-orange font-semibold" : "text-brand-slate"}>
            {it.estado === "error" ? "⚠ " : "✓ "}{it.etiqueta || it.herramienta} <span className="font-mono text-brand-mist">({it.herramienta})</span>
          </span>
          {it.entrada !== undefined && <Detalle titulo="Pedido">{JSON.stringify(it.entrada, null, 2)}</Detalle>}
          {it.resultado && <Detalle titulo="Respuesta de la plataforma">{it.resultado}</Detalle>}
        </div>
      );
    case "accion":
      return (
        <div className="ml-7">
          <TarjetaAccion a={it.accion} onConfirmar={() => {}} onCancelar={() => {}} />
          {"entrada" in it && (it as any).entrada && <Detalle titulo="Pedido">{JSON.stringify((it as any).entrada, null, 2)}</Detalle>}
        </div>
      );
    case "lienzo":
      return (
        <div className="ml-7">
          <div className="text-[11px] font-semibold text-brand-slate mb-1">Mostró en el lienzo</div>
          <PiezaLienzo spec={it.artefacto.spec} compacto />
          {it.entrada !== undefined && <Detalle titulo="Pedido">{JSON.stringify(it.entrada, null, 2)}</Detalle>}
        </div>
      );
    case "aviso":
      return <div className="text-center text-xs text-brand-slate">— {it.texto} —</div>;
  }
}

function Transcripcion({ id, onCerrar }: { id: string; onCerrar: () => void }) {
  const [t, setT] = useState<(TranscripcionVoi & { conversacion: any }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiFetch<TranscripcionVoi>(`${VOI_API}/admin/conversaciones/${id}`).then(setT as any).catch((e) => setError(e.message));
  }, [id]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [onCerrar]);
  const c = t?.conversacion;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30 animate-fade" onClick={onCerrar}>
      <div className="h-full w-full max-w-2xl bg-white shadow-elevated flex flex-col animate-pop" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Conversación con Voi">
        <div className="px-5 py-4 border-b border-brand-border flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-display text-xl text-brand-ink truncate">{c?.titulo ?? "Conversación"}</div>
            {c && (
              <div className="text-xs text-brand-slate mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                <span>{c.user_nombre} · {ROLE_LABELS[c.perfil] ?? c.perfil}</span>
                <span>Modo {c.modo}</span>
                <span>{usd(c.costo_usd)}{c.tope_usd ? ` de ${usd(c.tope_usd)}` : ""}</span>
                <span>{num(c.tokens?.input_tokens)} tokens de entrada · {num(c.tokens?.output_tokens)} de salida</span>
                {c.agente_version && <span>Agente v{c.agente_version}</span>}
                {c.oculta && <span className="inline-flex items-center gap-1 text-brand-orange"><EyeOff size={12} /> El usuario la quitó de su lista</span>}
              </div>
            )}
          </div>
          <button type="button" onClick={onCerrar} className="p-2 rounded-lg text-brand-slate hover:bg-brand-bg" aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {error && <p className="text-sm text-brand-primary">{error}</p>}
          {!t && !error && <div className="text-sm text-brand-mist flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Cargando…</div>}
          {t?.items.map((it) => <ItemAdmin key={it.id} it={it} />)}
        </div>
        <div className="px-5 py-2.5 border-t border-brand-border text-[11px] text-brand-mist">Esta lectura quedó registrada en la auditoría.</div>
      </div>
    </div>
  );
}

export function TabConversaciones() {
  const [items, setItems] = useState<ConversacionAdminVoi[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [perfil, setPerfil] = useState("");
  const [cargando, setCargando] = useState(true);
  const [abierta, setAbierta] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const p = new URLSearchParams({ limite: "100" });
    if (q.trim()) p.set("q", q.trim());
    if (perfil) p.set("perfil", perfil);
    try {
      const r = await apiFetch<{ total: number; items: ConversacionAdminVoi[] }>(`${VOI_API}/admin/conversaciones?${p}`);
      setItems(r.items);
      setTotal(r.total);
    } catch { setItems([]); }
    setCargando(false);
  }, [q, perfil]);
  useEffect(() => { const t = setTimeout(cargar, 250); return () => clearTimeout(t); }, [cargar]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-mist" />
          <input className="input pl-9" placeholder="Buscar por título o usuario…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input sm:w-48" value={perfil} onChange={(e) => setPerfil(e.target.value)}>
          <option value="">Todos los perfiles</option>
          {["superadmin", "gerente", "sub_gerente", "coordinador", "auditor", "controller", "analista"].map((p) => <option key={p} value={p}>{ROLE_LABELS[p]}</option>)}
        </select>
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-brand-bg">
              <tr className="text-left text-[10px] uppercase tracking-wider2 text-brand-slate">
                <th className="px-4 py-2.5 font-semibold">Conversación</th>
                <th className="px-3 py-2.5 font-semibold">Usuario</th>
                <th className="px-3 py-2.5 font-semibold text-right">Mensajes</th>
                <th className="px-3 py-2.5 font-semibold text-right">Consultas</th>
                <th className="px-3 py-2.5 font-semibold text-right">Acciones</th>
                <th className="px-3 py-2.5 font-semibold text-right">Gasto</th>
                <th className="px-4 py-2.5 font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} onClick={() => setAbierta(c.id)} className="border-t border-brand-border hover:bg-brand-bg-soft cursor-pointer">
                  <td className="px-4 py-2.5 max-w-[280px]">
                    <div className="font-medium text-brand-ink truncate">{c.titulo}</div>
                    <div className="text-[11px] text-brand-mist">{cuando(c.ultima_actividad)}{c.oculta ? " · quitada por el usuario" : ""}</div>
                  </td>
                  <td className="px-3 py-2.5"><div className="text-brand-graphite">{c.user_nombre}</div><div className="text-[11px] text-brand-mist">{c.perfil_nombre}</div></td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{num(c.mensajes)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{num(c.consultas)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{num(c.acciones)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{usd(c.costo_usd)}</td>
                  <td className="px-4 py-2.5"><span className={c.estado === "running" ? "badge-cyan" : c.estado === "requires_action" ? "badge-orange" : "badge-neutral"}>{ESTADO_CONV[c.estado] ?? c.estado}</span></td>
                </tr>
              ))}
              {!items.length && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-brand-mist">{cargando ? "Cargando…" : "No hay conversaciones con esos filtros."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {total > items.length && <div className="px-4 py-2 text-xs text-brand-slate border-t border-brand-border">Mostrando {items.length} de {total}. Afiná la búsqueda para ver otras.</div>}
      </div>
      {abierta && <Transcripcion id={abierta} onCerrar={() => setAbierta(null)} />}
    </div>
  );
}
