"use client";

/**
 * El logo de Voicenter en movimiento, para el login: los 25 puntos del isotipo se arman uno a uno, laten como un
 * ecualizador de voz y se desarman, en un ciclo continuo; abajo aparece la marca. Es SVG con animaciones CSS
 * (transform y opacity, en la GPU): no es un video, pesa unos pocos KB y no carga nada. Quien pidió menos
 * movimiento en su sistema lo ve quieto.
 *
 * `MuralPuntos`: el mural de puntos de la fachada (columnas de puntos de colores sobre el rojo), como fondo tenue.
 */
import { PUNTOS } from "@/components/voi/VoiIsotipo";

const BLANCO = "#FFFFFF";

export function LogoAnimado({ size = 240, sobreRojo = false, marca = true, className = "" }: {
  size?: number;
  /** Sobre el fondo rojo de la marca, los puntos rojos del isotipo van en blanco (como en la fachada). */
  sobreRojo?: boolean;
  marca?: boolean;
  className?: string;
}) {
  const alto = marca ? 236 : 178;
  return (
    <svg viewBox={`0 0 168 ${alto}`} width={size} height={size * (alto / 168)} className={`logo-animado ${className}`} role="img" aria-label="Voicenter">
      {PUNTOS.map(([col, fila, color]) => (
        <circle key={`${col}-${fila}`} className="logo-animado-dot" cx={12 + col * 24} cy={12 + fila * 22} r={8.2}
          fill={sobreRojo && color === "#E6332A" ? BLANCO : color}
          style={{ animationDelay: `${(col * 0.09 + fila * 0.035).toFixed(3)}s` }} />
      ))}
      {marca && (
        <text x="84" y="222" textAnchor="middle" className="logo-animado-marca" fill={sobreRojo ? BLANCO : "#E6332A"}
          fontFamily="Manrope, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" fontWeight={800} fontSize="38" letterSpacing="-1.2">
          voicenter
        </text>
      )}
    </svg>
  );
}

const MURAL_COLORES = [BLANCO, "#00B2BF", "#662483", "#F39200", BLANCO, "#FFD400", BLANCO, "#00B2BF"];
const MURAL_COLS = 26;
const MURAL_FILAS = 11;

/** Cuántos puntos tiene cada columna (una onda, como el ecualizador de la fachada), de forma fija. */
function alturaColumna(c: number): number {
  const onda = Math.sin(c * 0.9) * 2.4 + Math.sin(c * 0.37 + 1.3) * 1.8;
  return Math.max(2, Math.min(MURAL_FILAS, Math.round(6 + onda)));
}

export function MuralPuntos({ className = "" }: { className?: string }) {
  const paso = 30;
  return (
    <svg viewBox={`0 0 ${MURAL_COLS * paso} ${MURAL_FILAS * paso}`} preserveAspectRatio="xMidYMid slice"
      className={`logo-mural ${className}`} aria-hidden>
      {Array.from({ length: MURAL_COLS }, (_, c) => {
        const n = alturaColumna(c);
        const desde = Math.floor((MURAL_FILAS - n) / 2);
        return (
          <g key={c} className="logo-mural-col" style={{ animationDelay: `${(c * 0.21).toFixed(2)}s` }}>
            {Array.from({ length: n }, (_, k) => {
              const fila = desde + k;
              const color = MURAL_COLORES[(c * 3 + fila * 5) % MURAL_COLORES.length];
              return <circle key={fila} cx={paso / 2 + c * paso} cy={paso / 2 + fila * paso} r={paso * 0.31} fill={color} />;
            })}
          </g>
        );
      })}
    </svg>
  );
}
