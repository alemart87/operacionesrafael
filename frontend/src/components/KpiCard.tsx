interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  accent?: "primary" | "secondary" | "danger" | "neutral" | "cyan" | "purple" | "orange";
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

export function KpiCard({ label, value, hint, accent = "neutral" }: KpiCardProps) {
  return (
    <div className={`card p-5 border-l-[3px] ${ACCENT_CLS[accent]}`}>
      <div className="text-[10px] uppercase tracking-wider2 font-semibold text-brand-slate">
        {label}
      </div>
      <div className="mt-1.5 font-display text-3xl text-brand-ink">{value}</div>
      {hint && <div className="mt-1.5 text-xs text-brand-slate">{hint}</div>}
    </div>
  );
}
