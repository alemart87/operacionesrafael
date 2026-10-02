interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  accent?: "primary" | "secondary" | "danger" | "neutral" | "cyan" | "purple" | "orange";
  /** Si viene, la tarjeta es un enlace que abre el detalle en una pestaña nueva. */
  href?: string;
  cta?: string;
}

const ACCENT_CLS: Record<NonNullable<KpiCardProps["accent"]>, string> = {
  primary: "border-l-brand-primary",
  secondary: "border-l-brand-ink",
  danger: "border-l-brand-primary",
  neutral: "border-l-brand-mist",
  cyan: "border-l-brand-cyan",
  purple: "border-l-brand-purple",
  orange: "border-l-brand-orange",
};

export function KpiCard({ label, value, hint, accent = "neutral", href, cta = "Ver detalle" }: KpiCardProps) {
  const contenido = (
    <>
      <div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate">
        {label}
      </div>
      <div className="mt-1.5 font-display text-3xl text-brand-ink">{value}</div>
      {hint && <div className="mt-1.5 text-xs text-brand-slate">{hint}</div>}
      {href && (
        <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-primary group-hover:gap-1.5 transition-all print:hidden">
          {cta} <span aria-hidden>↗</span>
        </div>
      )}
    </>
  );
  if (!href) return <div className={`card p-5 border-l-[3px] ${ACCENT_CLS[accent]}`}>{contenido}</div>;
  return (
    <a href={href} target="_blank" rel="noopener" title={`${cta} (pestaña nueva)`}
      className={`group block card p-5 border-l-[3px] ${ACCENT_CLS[accent]} transition-all hover:shadow-elevated hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-brand-primary`}>
      {contenido}
    </a>
  );
}
