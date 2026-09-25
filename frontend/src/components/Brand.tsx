interface BrandProps {
  /** Mostrar el texto institucional al lado del isologo */
  withTagline?: boolean;
  /** Alto del isologo en px. El manual pide mínimo 24px. */
  logoHeight?: number;
  variant?: "default" | "light";
  /** En teléfonos angostos (menos de 440px) muestra solo el isologo, para que la cabecera no desborde. */
  compactOnPhone?: boolean;
}

export function Brand({ withTagline = true, logoHeight = 38, variant = "default", compactOnPhone = false }: BrandProps) {
  const light = variant === "light";
  return (
    <div className="flex items-center gap-4">
      <div className="flex-shrink-0" style={{ height: logoHeight }}>
        <img
          src="/logo-voicenter-color.png"
          alt="Voicenter"
          style={{ height: logoHeight, width: "auto", display: "block" }}
        />
      </div>
      {withTagline && (
        <div className={`leading-tight border-l border-brand-border pl-4 ${compactOnPhone ? "hidden min-[440px]:block" : ""}`}>
          <div className={`font-display text-base ${light ? "text-white" : "text-brand-ink"} uppercase tracking-wide`}>
            Operaciones <span className="text-brand-primary">Voicenter</span>
          </div>
          <div className={`text-[11px] ${light ? "text-white/70" : "text-brand-slate"} mt-0.5`}>
            Gerencia Expansión RM
          </div>
        </div>
      )}
    </div>
  );
}
