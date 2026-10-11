"use client";

/**
 * Estado de guardado del informe de auditoría, visible en su cabecera: «Guardando…», «Guardado 13:05», «Sin guardar»
 * o «No se pudo guardar». Las pestañas lo actualizan con `guardado.*` cada vez que mandan algo al servidor (la
 * redacción y los gráficos se guardan solos mientras se edita; los hallazgos, la evidencia y el seguimiento, al
 * instante). Si hay algo sin guardar, el navegador avisa antes de cerrar la pestaña.
 */
import { AlertCircle, Check, CloudUpload, Loader2 } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

export type EstadoGuardado =
  | { tipo: "inicial" }
  | { tipo: "pendiente" }
  | { tipo: "guardando" }
  | { tipo: "guardado"; at: Date }
  | { tipo: "error"; mensaje: string; reintentar?: () => void };

let estado: EstadoGuardado = { tipo: "inicial" };
const oyentes = new Set<() => void>();
const emitir = (e: EstadoGuardado) => { estado = e; oyentes.forEach((f) => f()); };

export const guardado = {
  pendiente: () => emitir({ tipo: "pendiente" }),
  guardando: () => emitir({ tipo: "guardando" }),
  listo: () => emitir({ tipo: "guardado", at: new Date() }),
  error: (mensaje: string, reintentar?: () => void) => emitir({ tipo: "error", mensaje, reintentar }),
  reiniciar: () => emitir({ tipo: "inicial" }),
  /** Envuelve un guardado: marca «guardando» y, según salga, «guardado» o el error (que vuelve a lanzar). */
  async con<T>(fn: () => Promise<T>, reintentar?: () => void): Promise<T> {
    emitir({ tipo: "guardando" });
    try {
      const r = await fn();
      emitir({ tipo: "guardado", at: new Date() });
      return r;
    } catch (e: any) {
      emitir({ tipo: "error", mensaje: e?.message ?? "No se pudo guardar", reintentar });
      throw e;
    }
  },
};

export function useEstadoGuardado(): EstadoGuardado {
  return useSyncExternalStore((f) => { oyentes.add(f); return () => oyentes.delete(f); }, () => estado, () => estado);
}

const hora = (d: Date) => d.toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" });

/** El indicador de la cabecera del informe. */
export function IndicadorGuardado({ editable }: { editable: boolean }) {
  const e = useEstadoGuardado();
  useEffect(() => () => guardado.reiniciar(), []);
  // Algo sin guardar: el navegador pregunta antes de cerrar o recargar.
  useEffect(() => {
    if (e.tipo !== "pendiente" && e.tipo !== "guardando") return;
    const f = (ev: BeforeUnloadEvent) => { ev.preventDefault(); ev.returnValue = ""; };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, [e.tipo]);

  if (!editable) {
    return <span className="inline-flex items-center gap-1.5 text-xs text-brand-slate" title="El informe está cerrado: no se edita"><Check size={13} /> Solo lectura</span>;
  }
  if (e.tipo === "guardando") {
    return <span className="inline-flex items-center gap-1.5 text-xs text-brand-slate" aria-live="polite"><Loader2 size={13} className="animate-spin text-brand-cyan" /> Guardando…</span>;
  }
  if (e.tipo === "pendiente") {
    return <span className="inline-flex items-center gap-1.5 text-xs text-brand-slate" aria-live="polite"><CloudUpload size={13} /> Sin guardar</span>;
  }
  if (e.tipo === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-brand-primary" role="alert" title={e.mensaje}>
        <AlertCircle size={13} /> No se pudo guardar
        {e.reintentar && <button type="button" onClick={e.reintentar} className="font-semibold underline">Reintentar</button>}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-brand-slate" aria-live="polite" title="Los cambios se guardan solos">
      <Check size={13} className="text-emerald-600" /> {e.tipo === "guardado" ? `Guardado ${hora(e.at)}` : "Se guarda solo"}
    </span>
  );
}
