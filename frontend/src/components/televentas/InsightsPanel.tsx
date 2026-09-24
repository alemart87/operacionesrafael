"use client";

interface Insight {
  tipo: string;
  severidad: "info" | "warning" | "alert" | string;
  titulo: string;
  detalle: string;
  vendedores?: string[];
}

const STYLES: Record<string, { bar: string; chip: string }> = {
  alert: { bar: "border-brand-primary", chip: "bg-brand-primary/10 text-brand-primary" },
  warning: { bar: "border-brand-orange", chip: "bg-brand-orange/10 text-brand-orange" },
  info: { bar: "border-brand-cyan", chip: "bg-brand-cyan/10 text-brand-cyan" },
};

const LABEL: Record<string, string> = { alert: "Alerta", warning: "Atención", info: "Info" };

export function InsightsPanel({ insights, titulo = "Análisis automático" }: { insights?: Insight[]; titulo?: string }) {
  if (!insights || insights.length === 0) return null;
  return (
    <section className="mb-6">
      <h2 className="text-[11px] uppercase tracking-wider2 text-brand-slate font-semibold mb-3">{titulo}</h2>
      <div className="grid md:grid-cols-2 gap-3">
        {insights.map((i, idx) => {
          const s = STYLES[i.severidad] ?? STYLES.info;
          return (
            <div key={idx} className={`card p-4 border-l-4 ${s.bar}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[10px] uppercase tracking-wider2 font-bold px-1.5 py-0.5 rounded ${s.chip}`}>
                  {LABEL[i.severidad] ?? i.severidad}
                </span>
                <span className="font-semibold text-brand-ink text-sm">{i.titulo}</span>
              </div>
              <p className="text-xs text-brand-slate leading-relaxed">{i.detalle}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
