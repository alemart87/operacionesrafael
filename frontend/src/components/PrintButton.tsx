"use client";

/** Botón "Imprimir PDF" — usa la impresión nativa del navegador (Guardar como PDF). */
export function PrintButton({ label = "Imprimir PDF", className = "" }: { label?: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={`no-print btn-ghost inline-flex items-center gap-2 ${className}`}
      title="Imprimir o guardar como PDF"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <rect x="6" y="14" width="12" height="8" rx="1" />
      </svg>
      {label}
    </button>
  );
}

/** Encabezado corporativo que aparece SOLO al imprimir (membrete del informe). */
export function PrintHeader({ titulo, subtitulo }: { titulo: string; subtitulo?: string }) {
  return (
    <div className="print-only print-header">
      <div className="print-header-row">
        <img src="/logo-voicenter-color.png" alt="Voicenter" style={{ height: 30, width: "auto" }} />
        <span className="print-header-kicker">Operaciones · Voicenter</span>
      </div>
      <h1 className="print-header-title">{titulo}</h1>
      {subtitulo && <div className="print-header-sub">{subtitulo}</div>}
    </div>
  );
}

/** Portada corporativa de página completa (solo impresión): logo + título elegido. */
export function PrintCover({ titulo, periodo }: { titulo: string; periodo?: string }) {
  const fecha = new Date().toLocaleDateString("es-PY", { day: "2-digit", month: "long", year: "numeric" });
  return (
    <div className="print-only print-cover">
      <div className="print-cover-band" />
      <div className="print-cover-body">
        <img src="/logo-voicenter-color.png" alt="Voicenter" style={{ height: 64, width: "auto", marginBottom: 18 }} />
        <div className="print-cover-kicker">Operaciones · Voicenter</div>
        <h1 className="print-cover-title">{titulo || "Informe General"}</h1>
        <div className="print-cover-rule" />
        {periodo && <div className="print-cover-period">{periodo}</div>}
      </div>
      <div className="print-cover-footer">
        <span>Plataforma operada por Voicenter S.A.</span>
        <span>Informe generado el {fecha}</span>
      </div>
      <div className="print-cover-band bottom" />
    </div>
  );
}
