"use client";

import { BookOpen, CheckCircle2, Clock, Loader2, Wrench, XCircle, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { AccionVoi, VOI_API, cuando } from "@/lib/voi";
import { EstadoAdminVoi, NIVEL } from "./tipos";

const TONO_NIVEL: Record<number, string> = { 1: "badge-cyan", 2: "badge-purple", 3: "badge-orange" };
const corto = (p: string) => p.split(".").pop()?.replace(/_/g, " ") ?? p;

/** Qué puede hacer Voi: herramientas por nivel de autonomía y permiso, y las habilidades que carga según el perfil. */
export function TabAgente({ estado }: { estado: EstadoAdminVoi }) {
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <section className="card p-5">
        <h2 className="font-display text-xl text-brand-ink uppercase flex items-center gap-2"><Wrench size={18} className="text-brand-primary" /> Herramientas de la plataforma</h2>
        <p className="text-xs text-brand-slate mt-1 leading-snug">
          Voi las usa con los permisos de quien conversa (releídos en cada uso). Las consultas corren solas; lo propio queda
          registrado; lo que afecta a otros espera la confirmación del usuario.
        </p>
        <ul className="mt-4 divide-y divide-brand-border">
          {estado.herramientas.map((h) => (
            <li key={h.nombre} className="py-2.5 flex items-start gap-3">
              <span className={`${TONO_NIVEL[h.nivel] ?? "badge-neutral"} shrink-0 mt-0.5`}>{NIVEL[h.nivel]}</span>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-brand-ink">{h.etiqueta}</div>
                <div className="text-[11px] text-brand-slate">
                  <span className="font-mono">{h.nombre}</span>
                  {h.permisos.length > 0 && <> · requiere {h.permisos.map(corto).join(" o ")}</>}
                  {!h.modos.includes("auditor") && <> · no en modo auditoría</>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="card p-5">
        <h2 className="font-display text-xl text-brand-ink uppercase flex items-center gap-2"><BookOpen size={18} className="text-brand-primary" /> Habilidades (Agent Skills)</h2>
        <p className="text-xs text-brand-slate mt-1 leading-snug">
          Guías que Voi carga cuando las necesita. Cada sesión recibe solo las de los módulos del usuario; el auditor, las de auditoría y alertas.
        </p>
        <ul className="mt-4 divide-y divide-brand-border">
          {estado.habilidades.map((h) => (
            <li key={h.nombre} className="py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-brand-ink">{h.titulo}</span>
                {h.al_dia ? <span className="badge-success">v{String(h.version ?? "—").slice(-6)}</span> : <span className="badge-orange">Sin publicar</span>}
                {h.auditor && <span className="badge-neutral">Auditor</span>}
              </div>
              <p className="text-xs text-brand-slate mt-0.5 leading-snug">{h.descripcion}</p>
              {h.permisos.length > 0 && <p className="text-[11px] text-brand-mist mt-0.5">Solo con {h.permisos.map(corto).join(" o ")}</p>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

interface AccionAdmin extends AccionVoi { user_nombre: string; conversacion_id: string; ok: boolean }

export function TabAcciones() {
  const [items, setItems] = useState<AccionAdmin[] | null>(null);
  useEffect(() => {
    apiFetch<{ items: AccionAdmin[] }>(`${VOI_API}/admin/acciones?limite=100`).then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);
  if (items === null) return <div className="text-sm text-brand-mist flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Cargando…</div>;
  return (
    <div className="card overflow-hidden">
      <ul className="divide-y divide-brand-border">
        {items.map((a) => (
          <li key={a.id} className="px-4 py-3 flex items-start gap-3">
            {a.estado === "ejecutada" ? <CheckCircle2 size={16} className="text-emerald-600 mt-0.5 shrink-0" /> :
              a.estado === "pendiente" ? <Clock size={16} className="text-brand-orange mt-0.5 shrink-0" /> :
              a.estado === "ejecutando" ? <Zap size={16} className="text-brand-cyan mt-0.5 shrink-0" /> :
              <XCircle size={16} className="text-brand-slate mt-0.5 shrink-0" />}
            <div className="min-w-0 flex-1">
              <div className="text-sm text-brand-ink"><span className="font-semibold">{a.user_nombre}</span> · {a.etiqueta}</div>
              <div className="text-xs text-brand-slate mt-0.5 leading-snug">{a.resumen}</div>
              {a.mensaje && <div className="text-[11px] text-brand-mist mt-0.5">{a.mensaje}</div>}
            </div>
            <div className="text-right shrink-0">
              <span className={a.nivel >= 3 ? "badge-orange" : "badge-purple"}>{NIVEL[a.nivel]}</span>
              <div className="text-[11px] text-brand-mist mt-1">{cuando(a.created_at)}</div>
            </div>
          </li>
        ))}
        {!items.length && <li className="px-4 py-10 text-center text-sm text-brand-mist">Voi todavía no hizo ni propuso acciones.</li>}
      </ul>
    </div>
  );
}
