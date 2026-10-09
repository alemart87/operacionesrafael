"use client";

import { History, Lock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { fechaHora } from "@/components/productividad/tipos";
import { SUP_API, num, type ParametrosScoringCompletos } from "@/components/supervision/tipos";
import { apiFetch } from "@/lib/api";

export default function ParametrosPage() {
  return (
    <AppShell>
      <Parametros />
    </AppShell>
  );
}

type Form = {
  asesor: Record<"pospago" | "uso" | "conversacion" | "gpon", string>;
  supervisor: Record<"resultado" | "cobertura" | "foco" | "seguimiento" | "tickets", string>;
  uso_cero: string;
  min_horas_conversacion: string;
};

const ASESOR: { k: keyof Form["asesor"]; label: string; ayuda: string }[] = [
  { k: "pospago", label: "Pospago", ayuda: "Netas contra el objetivo de referencia al corte" },
  { k: "uso", label: "Uso de líneas", ayuda: "% de Pospago evaluables sin uso" },
  { k: "conversacion", label: "Conversación", ayuda: "% del tiempo conectado en conversación" },
  { k: "gpon", label: "GPON", ayuda: "Altas contra el objetivo de referencia al corte" },
];
const SUPERVISOR: { k: keyof Form["supervisor"]; label: string; ayuda: string }[] = [
  { k: "resultado", label: "Resultado del equipo", ayuda: "Los cuatro componentes sobre todo el equipo" },
  { k: "cobertura", label: "Cobertura de coaching", ayuda: "% del equipo con al menos un coaching en el mes" },
  { k: "foco", label: "Foco", ayuda: "Asesores en alerta con coaching sobre esa métrica" },
  { k: "seguimiento", label: "Seguimientos a tiempo", ayuda: "Compromisos con seguimiento en la fecha acordada" },
  { k: "tickets", label: "Tickets en plazo", ayuda: "Tickets respondidos y resueltos dentro del SLA" },
];

const aForm = (p: ParametrosScoringCompletos): Form => ({
  asesor: Object.fromEntries(Object.entries(p.asesor).map(([k, v]) => [k, String(v)])) as Form["asesor"],
  supervisor: Object.fromEntries(Object.entries(p.supervisor).map(([k, v]) => [k, String(v)])) as Form["supervisor"],
  uso_cero: String(p.uso_cero),
  min_horas_conversacion: String(p.min_horas_conversacion),
});
const suma = (o: Record<string, string>) => Object.values(o).reduce((a, v) => a + (Number(v) || 0), 0);

function Parametros() {
  const [p, setP] = useState<ParametrosScoringCompletos | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    apiFetch<ParametrosScoringCompletos>(`${SUP_API}/parametros/scoring`).then((x) => { setP(x); setF(aForm(x)); }).catch((e) => setError(e.message));
  }, []);

  const sumaA = f ? suma(f.asesor) : 0;
  const sumaS = f ? suma(f.supervisor) : 0;
  const cambiado = useMemo(() => !!p && !!f && JSON.stringify(aForm(p)) !== JSON.stringify(f), [p, f]);
  const valido = sumaA === 100 && sumaS === 100 && !!f && Number(f.uso_cero) > (p?.umbral_sin_uso ?? 10) && Number(f.min_horas_conversacion) >= 0.5;
  const edita = !!p?.puede_editar;

  const guardar = async () => {
    if (!f) return;
    setGuardando(true);
    setError(null);
    setOk(null);
    try {
      const body = {
        asesor: Object.fromEntries(Object.entries(f.asesor).map(([k, v]) => [k, Number(v)])),
        supervisor: Object.fromEntries(Object.entries(f.supervisor).map(([k, v]) => [k, Number(v)])),
        uso_cero: Number(f.uso_cero), min_horas_conversacion: Number(f.min_horas_conversacion),
      };
      const x = await apiFetch<ParametrosScoringCompletos>(`${SUP_API}/parametros/scoring`, { method: "PUT", body: JSON.stringify(body) });
      setP(x);
      setF(aForm(x));
      setOk(`Guardado como versión ${x.version}. El scoring ya se calcula con estos pesos.`);
    } catch (e: any) { setError(e.message); } finally { setGuardando(false); }
  };

  const campo = (valor: string, onChange: (v: string) => void, label: string, extra?: { step?: string; min?: number; max?: number }) => (
    <input type="number" inputMode="decimal" className="input w-24 py-1.5 tabular-nums text-right" aria-label={label} disabled={!edita}
      step={extra?.step ?? "1"} min={extra?.min ?? 0} max={extra?.max ?? 100} value={valor} onChange={(e) => onChange(e.target.value)} />
  );

  return (
    <>
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Supervisión</div>
          <h1 className="font-display text-4xl text-brand-ink uppercase leading-tight">Parámetros del modelo</h1>
          <p className="text-sm text-brand-slate mt-2 max-w-3xl">
            Pesos y umbrales del scoring. Cada cambio es una versión nueva: queda en el historial y en la auditoría.
            {!edita && " Solo los cambian el sub gerente y el superadmin."}
          </p>
        </div>
        {edita && (
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" disabled={!cambiado || guardando} onClick={() => p && setF(aForm(p))}>Descartar</button>
            <button type="button" className="btn-primary" disabled={!cambiado || !valido || guardando} onClick={guardar}>
              {guardando ? "Guardando…" : cambiado ? "Guardar versión nueva" : "Sin cambios"}
            </button>
          </div>
        )}
      </div>
      {error && <div className="card p-4 text-sm text-brand-primary mb-4">{error}</div>}
      {ok && <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-md px-3 py-2.5">{ok}</div>}
      {!p || !f ? (
        !error && <div className="card p-10 text-brand-slate">Cargando…</div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-5 items-start">
          <Bloque titulo="Asesor" suma={sumaA}>
            {ASESOR.map((x) => (
              <Fila key={x.k} label={x.label} ayuda={x.ayuda}>
                {campo(f.asesor[x.k], (v) => setF({ ...f, asesor: { ...f.asesor, [x.k]: v } }), `Peso de ${x.label}`)}
              </Fila>
            ))}
          </Bloque>
          <Bloque titulo="Supervisor" suma={sumaS}>
            {SUPERVISOR.map((x) => (
              <Fila key={x.k} label={x.label} ayuda={x.ayuda}>
                {campo(f.supervisor[x.k], (v) => setF({ ...f, supervisor: { ...f.supervisor, [x.k]: v } }), `Peso de ${x.label}`)}
              </Fila>
            ))}
          </Bloque>
          <section className="card p-5">
            <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">Umbrales</h2>
            <ul className="mt-3 divide-y divide-brand-border">
              <Fila label="Uso: % sin uso con cero puntos" ayuda={`El puntaje completo es con ${num(p.umbral_sin_uso)}% o menos`}>
                {campo(f.uso_cero, (v) => setF({ ...f, uso_cero: v }), "Porcentaje sin uso con cero puntos", { step: "0.5", min: 1 })}
              </Fila>
              <Fila label="Conversación: horas mínimas" ayuda="Con menos horas conectadas en el mes no se evalúa">
                {campo(f.min_horas_conversacion, (v) => setF({ ...f, min_horas_conversacion: v }), "Horas mínimas de conversación", { step: "0.5", min: 0.5, max: 40 })}
              </Fila>
              <Fijo label="Asesor en alerta" valor={`más del ${num(p.umbral_sin_uso)}% sin uso, con ${p.min_evaluables} evaluables`} />
              <Fijo label="Conversación" valor={`completo desde ${num(p.conversacion.meta_min)}%, cero con ${num(p.conversacion.rojo)}%, se marca sobre ${num(p.conversacion.meta_max)}%`}
                nota="Se editan en Productividad → parámetros" />
            </ul>
          </section>
          <section className="card p-5">
            <h2 className="font-display text-xl uppercase text-brand-ink leading-tight flex items-center gap-2"><History size={18} className="text-brand-slate" /> Versiones</h2>
            <p className="text-xs text-brand-slate mt-0.5">Vigente: versión {p.version}.</p>
            {!p.historial.length ? (
              <p className="text-sm text-brand-slate mt-3">Sin cambios: rigen los valores iniciales del modelo.</p>
            ) : (
              <ul className="mt-3 divide-y divide-brand-border">
                {p.historial.map((h) => (
                  <li key={h.version} className="py-2.5 text-sm">
                    <div className="font-semibold text-brand-ink">Versión {h.version}</div>
                    <div className="text-[11px] text-brand-slate">{h.por ?? "—"} · {fechaHora(h.fecha)} · reemplazó a la versión {h.antes.version}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function Bloque({ titulo, suma, children }: { titulo: string; suma: number; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-xl uppercase text-brand-ink leading-tight">{titulo}</h2>
        <span className={`text-xs font-semibold tabular-nums ${suma === 100 ? "text-emerald-700" : "text-brand-primary-dark"}`}>
          Suma {suma}{suma === 100 ? "" : " · tiene que dar 100"}
        </span>
      </div>
      <ul className="mt-3 divide-y divide-brand-border">{children}</ul>
    </section>
  );
}

function Fila({ label, ayuda, children }: { label: string; ayuda: string; children: React.ReactNode }) {
  return (
    <li className="py-2.5 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-brand-ink">{label}</div>
        <div className="text-[11px] text-brand-slate">{ayuda}</div>
      </div>
      {children}
    </li>
  );
}

function Fijo({ label, valor, nota }: { label: string; valor: string; nota?: string }) {
  return (
    <li className="py-2.5 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-brand-ink">{label}</div>
        <div className="text-[11px] text-brand-slate">{valor}</div>
      </div>
      <span className="inline-flex items-center gap-1 text-[10px] text-brand-mist whitespace-nowrap" title={nota ?? "Regla fija del modelo"}><Lock size={11} /> {nota ? "Productividad" : "Fijo"}</span>
    </li>
  );
}
