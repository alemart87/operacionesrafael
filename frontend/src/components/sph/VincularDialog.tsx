"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { n } from "@/components/productividad/tipos";
import { apiFetch } from "@/lib/api";
import { NivelChip } from "./ui";
import { SPH_API, vinculado, type AgenteSph, type Nivel, type VendedorPeriodo, type VentaSinAgente } from "./tipos";

type Opcion = { id: string; titulo: string; sub: string; sugerido: boolean; actual?: boolean; ocupado?: string; nivel?: Nivel };

export type Objetivo = { tipo: "agente"; agente: AgenteSph } | { tipo: "vendedor"; venta: VentaSinAgente };
type Accion = "vincular" | "descartar" | "automatico";

/**
 * Corrige el cruce de nombres: este agente es tal vendedor, no es ninguno, o vuelve al cruce
 * automático. Se guarda para los próximos cálculos; al guardar, el SPH del día se recalcula.
 */
export function VincularDialog({ objetivo, agentes, vendedores, manual, onCerrar, onGuardado }: {
  objetivo: Objetivo | null;
  agentes: AgenteSph[];
  vendedores: VendedorPeriodo[];
  /** Vínculos manuales vigentes (clave del agente → vendedor; null = no vincular). */
  manual: Record<string, string | null>;
  onCerrar: () => void;
  onGuardado: () => Promise<void> | void;
}) {
  const [q, setQ] = useState("");
  const [elegido, setElegido] = useState<string | null>(null); // vendedor (modo agente) o clave (modo vendedor)
  const [accion, setAccion] = useState<Accion>("vincular");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setQ(""); setError(null); setAccion("vincular");
    setElegido(objetivo?.tipo === "agente" ? objetivo.agente.vendedor ?? objetivo.agente.candidatos[0] ?? null : null);
  }, [objetivo]);

  useEffect(() => {
    if (!objetivo || guardando) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [objetivo, guardando, onCerrar]);

  const duenio = useMemo(() => new Map(agentes.filter((a) => a.vendedor).map((a) => [a.vendedor as string, a])), [agentes]);

  const opciones = useMemo((): Opcion[] => {
    const t = q.trim().toLowerCase();
    if (objetivo?.tipo === "agente") {
      const cand = new Set(objetivo.agente.candidatos);
      const actual = objetivo.agente.vendedor;
      const peso = (v: string) => (v === actual ? 2 : cand.has(v) ? 1 : 0); // primero el actual, después los parecidos
      return vendedores
        .filter((v) => !t || v.vendedor.toLowerCase().includes(t))
        .sort((a, b) => peso(b.vendedor) - peso(a.vendedor) || a.vendedor.localeCompare(b.vendedor, "es"))
        .map((v) => ({ id: v.vendedor, titulo: v.vendedor, sub: [v.subcanal, `${n(v.netas_mes)} netas en el mes`].filter(Boolean).join(" · "),
          sugerido: cand.has(v.vendedor), actual: v.vendedor === actual,
          ocupado: duenio.get(v.vendedor)?.clave !== objetivo.agente.clave ? duenio.get(v.vendedor)?.nombre : undefined }));
    }
    return agentes
      .filter((a) => !t || a.nombre.toLowerCase().includes(t))
      .sort((a, b) => Number(vinculado(a.nivel)) - Number(vinculado(b.nivel)) || a.nombre.localeCompare(b.nombre, "es"))
      .map((a) => ({ id: a.clave, titulo: a.nombre, sub: a.vendedor ? `Hoy: ${a.vendedor}` : "Sin vínculo", sugerido: false, nivel: a.nivel }));
  }, [objetivo, vendedores, agentes, q, duenio]);

  if (!objetivo) return null;
  const agente = objetivo.tipo === "agente" ? objetivo.agente : null;
  const tieneManual = agente ? agente.clave in manual : false;

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      const destino = objetivo.tipo === "agente" ? objetivo.agente : agentes.find((a) => a.clave === elegido);
      if (!destino) throw new Error("Elegí el agente.");
      await apiFetch(`${SPH_API}/vinculos`, {
        method: "PUT",
        body: JSON.stringify({
          clave: destino.clave, nombre: destino.nombre, accion,
          vendedor: accion === "vincular" ? (objetivo.tipo === "agente" ? elegido : objetivo.venta.vendedor) : null,
        }),
      });
      await onGuardado();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  };

  const puede = accion !== "vincular" || !!elegido;
  // Revisar un vínculo automático y dejar el mismo vendedor = confirmarlo (pasa a manual).
  const confirma = !!agente && accion === "vincular" && !!agente.vendedor && elegido === agente.vendedor && agente.nivel !== "manual";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-brand-ink/50 backdrop-blur-[2px] animate-fade" onClick={() => !guardando && onCerrar()} />
      <div role="dialog" aria-modal="true" aria-labelledby="vincular-titulo" className="relative w-full max-w-lg card shadow-elevated overflow-y-auto max-h-[92vh] animate-pop">
        <div className="h-1.5 bg-brand-cyan" />
        <div className="p-6">
          <h2 id="vincular-titulo" className="font-display text-2xl text-brand-ink uppercase leading-tight">
            {agente ? "Vincular agente" : "Vincular vendedor"}
          </h2>
          {agente ? (
            <div className="mt-2 text-sm text-brand-graphite">
              <b>{agente.nombre}</b> <span className="text-brand-slate">(plataforma de llamadas)</span>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-brand-slate">
                Hoy: <NivelChip nivel={agente.nivel} compacto /> {agente.vendedor ?? "sin vendedor"}
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm text-brand-graphite">
              <b>{objetivo.tipo === "vendedor" && objetivo.venta.vendedor}</b> tiene {objetivo.tipo === "vendedor" && n(objetivo.venta.netas)} neta(s)
              sin asesor. ¿Qué agente de la plataforma es?
            </p>
          )}

          {agente && (
            <div className="mt-4 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Qué hacer">
              {([["vincular", "Es este vendedor"], ["descartar", "No es ninguno"], ...(tieneManual ? [["automatico", "Volver al cruce automático"]] : [])] as [Accion, string][]).map(([a, label]) => (
                <button key={a} type="button" role="radio" aria-checked={accion === a} onClick={() => setAccion(a)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${accion === a ? "bg-brand-ink text-white border-brand-ink" : "bg-white text-brand-slate border-brand-border hover:border-brand-ink"}`}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {accion === "vincular" && (
            <>
              <div className="relative mt-4">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-mist" />
                <input className="input pl-9 py-2" placeholder={agente ? "Buscar vendedor" : "Buscar agente"} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
              </div>
              <ul className="mt-2 max-h-64 overflow-y-auto rounded-md border border-brand-border divide-y divide-brand-border" role="listbox">
                {!opciones.length && <li className="px-3 py-3 text-xs text-brand-mist">Nada coincide con la búsqueda.</li>}
                {opciones.map((o) => (
                  <li key={o.id}>
                    <button type="button" role="option" aria-selected={elegido === o.id} onClick={() => setElegido(o.id)}
                      className={`w-full text-left px-3 py-2 flex items-start justify-between gap-2 ${elegido === o.id ? "bg-brand-cyan/10" : "hover:bg-brand-bg"}`}>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-brand-ink truncate">{o.titulo}</span>
                        <span className="block text-[11px] text-brand-slate">{o.sub}{o.ocupado && <> · hoy vinculado a <b>{o.ocupado}</b></>}</span>
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        {o.actual && <span className="text-[10px] font-semibold text-brand-ink">Actual</span>}
                        {o.sugerido && <span className="text-[10px] font-semibold text-brand-cyan">Parecido</span>}
                        {o.nivel && <NivelChip nivel={o.nivel} compacto />}
                        <span className={`w-3.5 h-3.5 rounded-full border ${elegido === o.id ? "border-brand-cyan bg-brand-cyan ring-2 ring-brand-cyan/30" : "border-brand-mist"}`} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {accion === "descartar" && <p className="mt-4 text-xs text-brand-slate">El agente queda sin vendedor aunque algún nombre se parezca: no entra en el SPH por asesor.</p>}
          {accion === "automatico" && <p className="mt-4 text-xs text-brand-slate">Se borra el vínculo manual y el sistema vuelve a buscarlo por nombre.</p>}

          <p className="mt-4 text-[11px] text-brand-mist">Se guarda para los próximos cálculos y este SPH se recalcula. Queda en auditoría.</p>
          {error && <div className="mt-3 rounded-md bg-brand-primary-light border border-brand-primary/30 text-brand-primary-dark text-sm p-3">{error}</div>}
          <div className="flex justify-end gap-2 mt-5">
            <button type="button" onClick={onCerrar} disabled={guardando} className="btn-secondary">Cancelar</button>
            <button type="button" onClick={guardar} disabled={!puede || guardando} className="btn-primary">
              {guardando ? "Guardando…" : confirma ? "Confirmar vínculo" : "Guardar y recalcular"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
