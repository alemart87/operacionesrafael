interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  accent?: "primary" | "secondary" | "danger" | "neutral" | "cyan" | "purple" | "orange";
  /** Si viene, la tarjeta es un enlace: a una sección de la misma página (`#id`, baja hasta ahí) o a otra pantalla (pestaña nueva). */
  href?: string;
  cta?: string;
}

/** Baja suavemente hasta una sección de la página, dejando lugar para la barra superior fija. */
export function irASeccion(id: string, margen = 72) {
  const el = document.getElementById(id);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - margen;
  window.scrollTo({ top, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  el.classList.add("ring-2", "ring-brand-primary/40");
  window.setTimeout(() => el.classList.remove("ring-2", "ring-brand-primary/40"), 1400);
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
  const enPagina = !!href && href.startsWith("#");
  const contenido = (
    <>
      <div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate">
        {label}
      </div>
      <div className="mt-1.5 font-display text-3xl text-brand-ink">{value}</div>
      {hint && <div className="mt-1.5 text-xs text-brand-slate">{hint}</div>}
      {href && (
        <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-primary group-hover:gap-1.5 transition-all print:hidden">
          {cta} <span aria-hidden>{enPagina ? "↓" : "↗"}</span>
        </div>
      )}
    </>
  );
  if (!href) return <div className={`card p-5 border-l-[3px] ${ACCENT_CLS[accent]}`}>{contenido}</div>;
  if (enPagina) {
    return (
      <a href={href} title={cta} onClick={(e) => { e.preventDefault(); irASeccion(href.slice(1)); }}
        className={`group block card p-5 border-l-[3px] ${ACCENT_CLS[accent]} transition-all hover:shadow-elevated hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-brand-primary`}>
        {contenido}
      </a>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener" title={`${cta} (pestaña nueva)`}
      className={`group block card p-5 border-l-[3px] ${ACCENT_CLS[accent]} transition-all hover:shadow-elevated hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-brand-primary`}>
      {contenido}
    </a>
  );
}
