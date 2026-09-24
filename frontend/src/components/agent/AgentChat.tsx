"use client";

import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CanvasArtifact, type Artifact } from "@/components/agent/CanvasArtifact";
import { Markdown } from "@/components/agent/Markdown";
import { ThinkingTicker } from "@/components/agent/ThinkingTicker";
import { apiFetch, getToken } from "@/lib/api";
import { downloadCanvasHtml } from "@/lib/canvasExport";

interface Conversation { id: string; title: string | null; last_message_at: string | null; created_at: string; }
interface Message { role: "user" | "assistant"; content: string; reasoning?: string; artifacts: Artifact[]; streaming?: boolean; error?: boolean; }

export interface FocusOption {
  id: string;
  label: string;
  sublabel?: string;   // ej. "Liq 389 · 4.812 mov."
  badge?: string;      // ej. monto "Gs 904 M"
  published?: boolean; // estado publicado/borrador
}

export interface AgentChatProps {
  apiBase: string;            // ej. "/api/v1/agent" o "/api/v1/televentas-claro/facturacion-agent"
  title: string;
  emptyHeading: string;
  emptyHint: string;
  placeholder: string;
  suggestions: string[];
  deniedMessage: string;
  // Si se provee, muestra un selector de archivos/reportes (multi) para enfocar el análisis.
  loadFocusOptions?: () => Promise<FocusOption[]>;
  focusLabel?: string;        // ej. "Enfocar en"
}

export function AgentChat(props: AgentChatProps) {
  const { apiBase } = props;
  const [focusOptions, setFocusOptions] = useState<FocusOption[]>([]);
  const [focusSel, setFocusSel] = useState<string[]>([]);
  const [access, setAccess] = useState<{ configured: boolean; model: string; default_month: string } | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [canvasW, setCanvasW] = useState(440);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiFetch<{ configured: boolean; model: string; default_month: string }>(`${apiBase}/access`)
      .then(setAccess)
      .catch(() => setAccessDenied(true));
    loadConversations();
    if (props.loadFocusOptions) props.loadFocusOptions().then(setFocusOptions).catch(() => {});
  }, [apiBase]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const loadConversations = () =>
    apiFetch<Conversation[]>(`${apiBase}/conversations`).then(setConversations).catch(() => {});

  const selectConversation = async (id: string) => {
    setActiveId(id);
    setSidebarOpen(false);
    const msgs = await apiFetch<Message[]>(`${apiBase}/conversations/${id}/messages`);
    const norm = msgs.map((m) => ({ ...m, artifacts: m.artifacts || [], reasoning: m.reasoning || "" }));
    setMessages(norm);
    const arts = norm.flatMap((m) => m.artifacts);
    setArtifacts(arts);
    setCanvasOpen(arts.length > 0);
  };

  const newConversation = () => {
    setActiveId(null); setMessages([]); setArtifacts([]); setCanvasOpen(false); setSidebarOpen(false);
  };

  const deleteConversation = async (id: string) => {
    await apiFetch(`${apiBase}/conversations/${id}`, { method: "DELETE" });
    if (id === activeId) newConversation();
    loadConversations();
  };

  const patchLastAssistant = (fn: (m: Message) => Message) =>
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === "assistant") { next[i] = fn(next[i]); break; }
      }
      return next;
    });

  const sendMessage = async () => {
    const content = input.trim();
    if (!content || streaming) return;
    let convId = activeId;
    if (!convId) {
      const c = await apiFetch<Conversation>(`${apiBase}/conversations`, { method: "POST", body: JSON.stringify({}) });
      convId = c.id;
      setActiveId(c.id);
    }
    setMessages((p) => [...p, { role: "user", content, artifacts: [] }, { role: "assistant", content: "", reasoning: "", artifacts: [], streaming: true }]);
    setInput(""); setStreaming(true); setToolStatus(null);
    try {
      const token = getToken();
      const body: any = { content };
      if (focusSel.length > 0) body.focus_refs = focusSel;
      const res = await fetch(`${apiBase}/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) throw new Error("No se pudo iniciar el chat");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 2);
          if (!line.startsWith("data:")) continue;
          handleEvent(JSON.parse(line.slice(5).trim()));
        }
      }
    } catch (e: any) {
      patchLastAssistant((m) => ({ ...m, content: m.content || `⚠️ ${e.message}`, error: true, streaming: false }));
    } finally {
      setStreaming(false); setToolStatus(null);
      patchLastAssistant((m) => ({ ...m, streaming: false }));
      loadConversations();
    }
  };

  const handleEvent = (ev: any) => {
    if (ev.type === "token") {
      patchLastAssistant((m) => ({ ...m, content: m.content + ev.text }));
      setToolStatus(null);
    } else if (ev.type === "reasoning") {
      patchLastAssistant((m) => ({ ...m, reasoning: (m.reasoning || "") + ev.text }));
    } else if (ev.type === "tool") {
      setToolStatus(`Consultando datos: ${ev.name}…`);
    } else if (ev.type === "canvas") {
      const art: Artifact = ev.artifact;
      setArtifacts((p) => [...p, art]);
      setCanvasOpen(true);
      patchLastAssistant((m) => ({ ...m, artifacts: [...m.artifacts, art] }));
    } else if (ev.type === "done") {
      if (ev.content) patchLastAssistant((m) => ({ ...m, content: ev.content }));
      setToolStatus(null);
    } else if (ev.type === "error") {
      patchLastAssistant((m) => ({ ...m, content: `⚠️ ${ev.message}`, error: true }));
    }
  };

  const onDragCanvas = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = canvasW;
    const move = (ev: MouseEvent) => setCanvasW(Math.max(320, Math.min(760, startW + (startX - ev.clientX))));
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  if (accessDenied) {
    return <AppShell><div className="card p-12 text-center"><p className="text-brand-slate">{props.deniedMessage}</p></div></AppShell>;
  }

  return (
    <AppShell workspace>
      <div className="flex flex-1 min-h-0 w-full">
        <aside className={`${sidebarOpen ? "fixed inset-0 z-40 bg-black/30 md:bg-transparent md:static" : "hidden"} md:block md:relative w-full md:w-60 flex-shrink-0`}>
          <div className="bg-white md:bg-transparent h-full w-60 md:w-full border-r border-brand-border flex flex-col">
            <button onClick={newConversation} className="m-3 btn-primary text-sm py-2">+ Nueva conversación</button>
            <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
              {conversations.length === 0 && <p className="text-xs text-brand-slate px-2 py-3">Sin conversaciones aún.</p>}
              {conversations.map((c) => (
                <div key={c.id} className={`group flex items-center gap-1 rounded-md px-2 py-2 cursor-pointer text-sm ${activeId === c.id ? "bg-brand-cyan/10 text-brand-ink" : "hover:bg-brand-bg text-brand-graphite"}`}
                  onClick={() => selectConversation(c.id)}>
                  <span className="flex-1 truncate">{c.title || "Conversación"}</span>
                  <button onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}
                    className="opacity-0 group-hover:opacity-100 text-brand-mist hover:text-brand-primary text-xs px-1">✕</button>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <section className="flex-1 flex flex-col min-w-0 min-h-0 border-r border-brand-border">
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-brand-border">
            <div className="flex items-center gap-2 min-w-0">
              <button onClick={() => setSidebarOpen(true)} className="md:hidden text-brand-slate" aria-label="Historial">☰</button>
              <div className="min-w-0">
                <h1 className="font-display text-lg text-brand-ink uppercase leading-none">{props.title}</h1>
                <p className="text-[11px] text-brand-slate truncate">
                  {access ? <>{access.model}{!access.configured && " · ⚠️ servidor sin API key"}</> : "Cargando…"}
                </p>
              </div>
            </div>
            <button onClick={() => setCanvasOpen((o) => !o)} className="btn-ghost text-xs whitespace-nowrap">
              {canvasOpen ? "Ocultar canvas" : `Canvas${artifacts.length ? ` (${artifacts.length})` : ""}`}
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
            {messages.length === 0 && (
              <div className="max-w-xl mx-auto text-center mt-8">
                <div className="w-14 h-14 mx-auto rounded-xl bg-brand-cyan/10 text-brand-cyan flex items-center justify-center mb-4">
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>
                </div>
                <h2 className="font-display text-xl text-brand-ink uppercase">{props.emptyHeading}</h2>
                <p className="text-sm text-brand-slate mt-1 mb-5">{props.emptyHint}</p>
                <div className="grid sm:grid-cols-2 gap-2">
                  {props.suggestions.map((s) => (
                    <button key={s} onClick={() => setInput(s)} className="text-left text-sm card p-3 hover:border-brand-cyan transition-colors text-brand-graphite">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap bg-brand-ink text-white">{m.content}</div>
                </div>
              ) : (
                <AssistantBubble key={i} m={m} toolStatus={m.streaming ? toolStatus : null} onOpenCanvas={() => setCanvasOpen(true)} />
              )
            )}
          </div>

          <div className="border-t border-brand-border p-3">
            {focusOptions.length > 0 && (
              <div className="max-w-3xl mx-auto mb-2">
                <FocusPicker options={focusOptions} selected={focusSel} onChange={setFocusSel} label={props.focusLabel} />
              </div>
            )}
            <div className="flex items-end gap-2 max-w-3xl mx-auto">
              <textarea value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder={props.placeholder} rows={1}
                className="flex-1 resize-none rounded-xl border border-brand-border px-4 py-2.5 text-sm focus:outline-none focus:border-brand-cyan max-h-32" />
              <button onClick={sendMessage} disabled={streaming || !input.trim()} className="btn-primary px-4 py-2.5 disabled:opacity-50">
                {streaming ? "…" : "Enviar"}
              </button>
            </div>
          </div>
        </section>

        {canvasOpen && (
          <>
            <div onMouseDown={onDragCanvas} className="hidden md:block w-1.5 cursor-col-resize bg-brand-border/40 hover:bg-brand-cyan/40" />
            <aside className="fixed inset-0 z-40 md:static md:z-auto flex-shrink-0 flex flex-col bg-brand-bg-soft overflow-hidden w-full md:w-auto" style={{ width: typeof window !== "undefined" && window.innerWidth < 768 ? undefined : canvasW }}>
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-brand-border bg-white">
                <span className="text-[11px] uppercase tracking-wider2 font-bold text-brand-slate">Canvas</span>
                <div className="flex items-center gap-2">
                  {artifacts.length > 0 && (
                    <button onClick={() => downloadCanvasHtml(artifacts, { title: conversations.find((c) => c.id === activeId)?.title || "Informe", month: access?.default_month })}
                      title="Descargar HTML (para imprimir como PDF)" className="text-[11px] font-semibold text-brand-cyan hover:text-brand-ink inline-flex items-center gap-1">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></svg>
                      Descargar
                    </button>
                  )}
                  <button onClick={() => setCanvasOpen(false)} className="text-brand-mist hover:text-brand-ink text-sm">✕</button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {artifacts.length === 0 && <p className="text-xs text-brand-slate text-center mt-8">El agente dibujará gráficos y análisis acá cuando los necesite.</p>}
                {artifacts.map((a) => <div id={`art-card-${a.id}`} key={a.id}><CanvasArtifact artifact={a} /></div>)}
              </div>
            </aside>
          </>
        )}
      </div>
    </AppShell>
  );
}

const FOCUS_GRAD = "linear-gradient(135deg,#662483 0%,#00B2BF 100%)";

function FileGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 13h6" /><path d="M9 17h4" />
    </svg>
  );
}

function FocusPicker({ options, selected, onChange, label }: {
  options: FocusOption[]; selected: string[]; onChange: (s: string[]) => void; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const active = selected.length > 0;
  const allSel = selected.length > 0 && selected.length === options.length;
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const filtered = options.filter((o) => `${o.label} ${o.sublabel || ""}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={() => setOpen((o) => !o)}
          className={`group inline-flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-xs font-semibold transition-all duration-200 ${active ? "text-white" : "border border-brand-border bg-white text-brand-graphite hover:border-brand-cyan hover:shadow-sm"}`}
          style={active ? { backgroundImage: FOCUS_GRAD, boxShadow: "0 6px 18px -6px rgba(102,36,131,.55)" } : undefined}
        >
          <span className="flex items-center justify-center w-6 h-6 rounded-full text-white" style={active ? { background: "rgba(255,255,255,.2)" } : { backgroundImage: FOCUS_GRAD }}>
            <FileGlyph />
          </span>
          <span>{label || "Enfocar análisis"}{active ? ` · ${selected.length}` : ""}</span>
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" className={`transition-transform ${open ? "rotate-180" : ""}`}><path d="m6 9 6 6 6-6" /></svg>
        </button>

        {selected.map((id) => {
          const o = options.find((x) => x.id === id);
          return (
            <span key={id} className="inline-flex items-center gap-1 text-[11px] font-medium pl-2 pr-1 py-0.5 rounded-full text-[#5b1f78]" style={{ background: "linear-gradient(135deg,rgba(102,36,131,.12),rgba(0,178,191,.14))" }}>
              {o?.label || id}
              <button onClick={() => onChange(selected.filter((x) => x !== id))} className="w-4 h-4 inline-flex items-center justify-center rounded-full hover:bg-white/60 hover:text-brand-primary">✕</button>
            </span>
          );
        })}
        {active && <button onClick={() => onChange([])} className="text-[11px] text-brand-slate hover:text-brand-primary">limpiar</button>}
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full mb-2 left-0 z-20 w-[23rem] max-w-[92vw] rounded-2xl border border-brand-border bg-white overflow-hidden shadow-elevated animate-pop">
            <div className="px-4 py-3 text-white" style={{ backgroundImage: FOCUS_GRAD }}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider2 font-bold opacity-80">Foco del análisis</div>
                  <div className="text-sm font-semibold truncate">{active ? `${selected.length} liquidación(es) seleccionada(s)` : "Elegí una o más liquidaciones"}</div>
                </div>
                <span className="flex-shrink-0 text-[11px] font-semibold bg-white/20 rounded-full px-2 py-0.5">{options.length}</span>
              </div>
            </div>

            <div className="p-2 border-b border-brand-border">
              <div className="flex items-center gap-2 rounded-lg border border-brand-border bg-brand-bg px-2.5 py-1.5 focus-within:border-brand-cyan">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" className="text-brand-mist"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar período o liquidación…" className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-brand-mist" />
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto p-1.5 space-y-1">
              {filtered.length === 0 && <p className="text-xs text-brand-slate text-center py-5">Sin resultados.</p>}
              {filtered.map((o) => {
                const on = selected.includes(o.id);
                return (
                  <button key={o.id} onClick={() => toggle(o.id)}
                    className={`w-full flex items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors ${on ? "" : "hover:bg-brand-bg"}`}
                    style={on ? { background: "linear-gradient(135deg,rgba(102,36,131,.08),rgba(0,178,191,.10))" } : undefined}>
                    <span className={`flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center border transition-all ${on ? "border-transparent text-white" : "border-brand-mist text-transparent"}`} style={on ? { backgroundImage: FOCUS_GRAD } : undefined}>
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-brand-ink truncate">{o.label}</span>
                      {o.sublabel && <span className="block text-[11px] text-brand-slate truncate">{o.sublabel}</span>}
                    </span>
                    <span className="flex-shrink-0 text-right">
                      {o.badge && <span className="block text-[11px] font-semibold text-brand-ink tabular-nums">{o.badge}</span>}
                      {typeof o.published === "boolean" && (
                        <span className={`inline-block mt-0.5 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${o.published ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{o.published ? "Publicado" : "Borrador"}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between px-3 py-2 border-t border-brand-border bg-brand-bg-soft">
              <button onClick={() => onChange(allSel ? [] : options.map((o) => o.id))} className="text-[11px] font-semibold text-brand-cyan hover:text-brand-ink">
                {allSel ? "Quitar todo" : "Seleccionar todo"}
              </button>
              <button onClick={() => setOpen(false)} className="text-[11px] font-semibold rounded-full px-3.5 py-1 text-white transition-transform hover:scale-[1.03]" style={{ backgroundImage: FOCUS_GRAD }}>
                Aplicar{active ? ` (${selected.length})` : ""}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AssistantBubble({ m, toolStatus, onOpenCanvas }: { m: Message; toolStatus: string | null; onOpenCanvas: () => void }) {
  const [open, setOpen] = useState(false);
  const reasonRef = useRef<HTMLDivElement>(null);
  const hasReasoning = !!(m.reasoning && m.reasoning.trim());
  const thinking = !!m.streaming && !m.content;
  const showReasoning = (!!m.streaming && hasReasoning) || open;

  useEffect(() => {
    if (m.streaming && reasonRef.current) reasonRef.current.scrollTop = reasonRef.current.scrollHeight;
  }, [m.reasoning, m.streaming]);

  return (
    <div className="flex justify-start">
      <div className="max-w-[88%] w-full">
        {(thinking || hasReasoning) && (
          <div className="mb-1.5">
            <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider2">
              {m.streaming ? <span className="shimmer-text">{toolStatus ? "Consultando…" : "Pensando…"}</span> : <span className="text-brand-slate">Razonamiento</span>}
              {hasReasoning && (<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" className={`text-brand-mist transition-transform ${showReasoning ? "rotate-180" : ""}`}><path d="m6 9 6 6 6-6" /></svg>)}
            </button>
            {showReasoning && hasReasoning && (
              <div ref={reasonRef} className="mt-1 rounded-lg bg-brand-bg-soft border border-brand-border px-3 py-2 max-h-60 overflow-y-auto reasoning-box">
                <div className="text-[12px] text-brand-slate leading-relaxed"><Markdown>{m.reasoning + (m.streaming && thinking ? " ▍" : "")}</Markdown></div>
              </div>
            )}
            {toolStatus && (<div className="mt-1 rounded-md shimmer-bar px-3 py-1.5 text-[11px] text-brand-cyan flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-brand-cyan animate-pulse" />{toolStatus}</div>)}
            {!!m.streaming && !m.content && <ThinkingTicker />}
          </div>
        )}
        {(m.content || (!!m.streaming && !thinking)) && (
          <div className={`rounded-2xl px-4 py-2.5 ${m.error ? "bg-brand-primary-light text-brand-primary-dark" : "bg-brand-bg text-brand-graphite"}`}>
            {m.content ? <Markdown>{m.content}</Markdown> : <span className="shimmer-text text-sm">▍</span>}
            {m.artifacts.length > 0 && (<button onClick={onOpenCanvas} className="mt-2 text-[11px] text-brand-cyan font-semibold hover:underline">📊 {m.artifacts.length} artefacto(s) en el canvas →</button>)}
          </div>
        )}
      </div>
    </div>
  );
}
