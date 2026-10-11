"use client";

/**
 * Isotipo de Voicenter redibujado en SVG (los mismos 25 puntos y colores del logo) para darle vida a Voi:
 * quieto, «pensando» (una onda recorre los puntos de izquierda a derecha) o «hablando» (la onda se acelera, como
 * un ecualizador de voz). Quien pidió menos movimiento en su sistema lo ve quieto.
 */
const R = "#E6332A";
const C = "#00B2BF";
const P = "#662483";
const O = "#F39200";

// [columna, fila, color] — tomado del logo oficial (public/logo-voicenter-color.png).
export const PUNTOS: [number, number, string][] = [
  [0, 4, R],
  [1, 3, C], [1, 4, C], [1, 5, C],
  [2, 1, P], [2, 2, P], [2, 3, P], [2, 4, P], [2, 5, P],
  [3, 3, O], [3, 4, O], [3, 5, O], [3, 6, O],
  [4, 0, R], [4, 1, R], [4, 2, R], [4, 3, R], [4, 4, R], [4, 5, R],
  [5, 3, C], [5, 4, C], [5, 5, C], [5, 6, C], [5, 7, C],
  [6, 4, R],
];

export type EstadoIsotipo = "quieto" | "pensando" | "hablando";

export function VoiIsotipo({
  size = 24,
  estado = "quieto",
  apagado = false,
  className = "",
  titulo,
}: {
  size?: number;
  estado?: EstadoIsotipo;
  /** Sin conexión o sin permiso: en gris. */
  apagado?: boolean;
  className?: string;
  titulo?: string;
}) {
  const clase = estado === "pensando" ? "voi-pensando" : estado === "hablando" ? "voi-hablando" : "";
  return (
    <svg
      viewBox="0 0 168 178"
      width={size}
      height={size * (178 / 168)}
      className={`${clase} ${apagado ? "grayscale opacity-50" : ""} flex-shrink-0 ${className}`}
      role={titulo ? "img" : undefined}
      aria-label={titulo}
      aria-hidden={titulo ? undefined : true}
    >
      {PUNTOS.map(([col, fila, color]) => (
        <circle
          key={`${col}-${fila}`}
          className="voi-dot"
          cx={12 + col * 24}
          cy={12 + fila * 22}
          r={8.2}
          fill={color}
          style={{ animationDelay: `${col * 95 + fila * 35}ms` }}
        />
      ))}
    </svg>
  );
}
