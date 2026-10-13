"use client";

/** Panel de marca del login, con el lenguaje de movimiento de los videos de Claude: fondo cálido con grano, mucho aire,
 *  titulares que entran palabra por palabra e ilustraciones de línea fina que se dibujan solas, una por módulo de la
 *  plataforma (ventas netas, productividad, supervisión, facturación, auditoría). Los puntos de la marca son los
 *  protagonistas de cada escena. El puntero inclina apenas la ilustración y lleva una luz suave detrás.
 *  Con `prefers-reduced-motion` queda la primera escena quieta. */
import { useEffect, useRef, useState } from "react";
import { LogoAnimado } from "@/components/LogoAnimado";

const ROJO = "#E6332A", CIAN = "#00B2BF", VIOLETA = "#662483", NARANJA = "#F39200", TINTA = "#0F1116";
const ESCENA_MS = 6200, SALIDA_MS = 650;

type Escena = { clave: string; nombre: string; frase: string };
const ESCENAS: Escena[] = [
  { clave: "ventas", nombre: "Ventas netas", frase: "Cada corte de Claro, leído al detalle." },
  { clave: "productividad", nombre: "Productividad", frase: "Las llamadas del día, contra la meta." },
  { clave: "supervision", nombre: "Supervisión", frase: "Cada supervisor, con su equipo y su coaching." },
  { clave: "facturacion", nombre: "Facturación", frase: "La liquidación, proyectada a doce meses." },
  { clave: "auditoria", nombre: "Auditoría", frase: "Lo que hay que mirar, antes que nadie." },
];

const d = (s: number) => ({ animationDelay: `${s}s` });

/* ------------------------------------------------------------------ escenas (SVG 520 × 400) */
const BASE = 330;

function Ventas() {
  const alturas = [96, 118, 104, 142, 130, 168, 156, 190, 212];
  const colores = [CIAN, VIOLETA, NARANJA, CIAN, ROJO, VIOLETA, NARANJA, CIAN, ROJO];
  const x = (i: number) => 70 + i * 47;
  const tendencia = alturas.map((h, i) => `${i ? "L" : "M"}${x(i)} ${BASE - h - 26}`).join(" ");
  return (
    <g>
      <line x1="40" y1={BASE} x2="480" y2={BASE} className="mm-trazo mm-draw" pathLength={1} style={d(0)} />
      {alturas.map((h, i) => (
        <g key={i}>
          <line x1={x(i)} y1={BASE} x2={x(i)} y2={BASE - h} className="mm-trazo mm-draw" pathLength={1} style={d(0.25 + i * 0.09)} />
          <circle cx={x(i)} cy={BASE - h} r={9} fill={colores[i]} className="mm-pop" style={d(0.75 + i * 0.09)} />
        </g>
      ))}
      <path d={tendencia} className="mm-acento mm-draw mm-lento" pathLength={1} style={d(1.7)} strokeDasharray="0.012 0.012" />
      <text x="480" y={BASE - 250} textAnchor="end" className="mm-cifra mm-fade" style={d(2.4)}>+21 %</text>
      <text x="480" y={BASE - 232} textAnchor="end" className="mm-etiqueta mm-fade" style={d(2.6)}>netas contra el mes anterior</text>
    </g>
  );
}

function Productividad() {
  const valores = [31, 35, 38, 36, 41, 44, 42, 46, 43, 45, 47, 44];
  const x = (i: number) => 50 + i * 38;
  const y = (v: number) => BASE - (v - 20) * 7.5;
  const linea = valores.map((v, i) => `${i ? "L" : "M"}${x(i)} ${y(v)}`).join(" ");
  return (
    <g>
      <rect x="40" y={y(47)} width="440" height={y(37) - y(47)} fill={CIAN} fillOpacity={0.14} className="mm-fade" style={d(0.1)} rx={6} />
      <text x="44" y={y(47) - 8} className="mm-etiqueta mm-fade" style={d(0.4)}>meta de conversación 37–47 %</text>
      <line x1="40" y1={BASE} x2="480" y2={BASE} className="mm-trazo mm-draw" pathLength={1} style={d(0)} />
      <path d={linea} className="mm-tinta mm-draw mm-lento" pathLength={1} style={d(0.5)} />
      {valores.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={i === valores.length - 2 ? 9 : 5} fill={i === valores.length - 2 ? ROJO : TINTA}
          className="mm-pop" style={d(0.6 + i * 0.16)} />
      ))}
      <text x={x(10)} y={y(47) - 26} textAnchor="middle" className="mm-cifra mm-fade" style={d(2.6)}>47 %</text>
    </g>
  );
}

function Supervision() {
  const cx = 260, cy = 200, R = 132;
  const asesores = Array.from({ length: 7 }, (_, i) => {
    const a = -Math.PI / 2 + (i / 7) * Math.PI * 2;
    return { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R * 0.86 };
  });
  const colores = [CIAN, NARANJA, VIOLETA, CIAN, NARANJA, VIOLETA, CIAN];
  return (
    <g>
      {asesores.map((p, i) => {
        const mx = (cx + p.x) / 2 + (p.y - cy) * 0.18, my = (cy + p.y) / 2 - (p.x - cx) * 0.18;
        return <path key={i} d={`M${cx} ${cy} Q${mx} ${my} ${p.x} ${p.y}`} className="mm-trazo mm-draw" pathLength={1} style={d(0.35 + i * 0.1)} />;
      })}
      <circle cx={cx} cy={cy} r={22} fill={TINTA} className="mm-pop" style={d(0.05)} />
      <circle cx={cx} cy={cy} r={34} className="mm-trazo mm-draw" pathLength={1} style={d(0.2)} />
      {asesores.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={11} fill={colores[i]} className="mm-pop" style={d(0.9 + i * 0.1)} />
      ))}
      <circle cx={asesores[2].x} cy={asesores[2].y} r={22} fill="none" stroke={ROJO} strokeWidth={2} className="mm-pulso" style={d(2.1)} />
      <path d={`M${asesores[5].x - 7} ${asesores[5].y} l5 5 l9 -10`} className="mm-blanco mm-draw" pathLength={1} style={d(2.3)} />
      <text x={asesores[2].x + 30} y={asesores[2].y + 4} className="mm-etiqueta mm-fade" style={d(2.4)}>seguimiento hoy</text>
    </g>
  );
}

function Facturacion() {
  const zafra = [99.9, 82.6, 58.5, 53.8, 53.1, 49.2, 51.1, 46.2, 41.9, 40.7, 40.1, 40.4, 41.8];
  const ideal = [99.9, 82.6, 75, 70, 67, 63, 60, 58, 56, 54, 53, 51, 49];
  const x = (i: number) => 50 + i * 35;
  const y = (v: number) => BASE - v * 2.5;
  const curva = (s: number[]) => s.map((v, i) => `${i ? "L" : "M"}${x(i)} ${y(v)}`).join(" ");
  const area = `${curva(zafra)} L${x(12)} ${BASE} L${x(0)} ${BASE} Z`;
  return (
    <g>
      <path d={area} fill={ROJO} fillOpacity={0.08} className="mm-fade" style={d(1.6)} />
      <line x1="40" y1={BASE} x2="480" y2={BASE} className="mm-trazo mm-draw" pathLength={1} style={d(0)} />
      <path d={curva(ideal)} className="mm-cian mm-draw mm-lento" pathLength={1} style={d(0.3)} strokeDasharray="0.01 0.012" />
      <path d={curva(zafra)} className="mm-tinta mm-draw mm-lento" pathLength={1} style={d(0.5)} />
      {zafra.map((v, i) => i !== 2 && <circle key={i} cx={x(i)} cy={y(v)} r={4} fill={TINTA} className="mm-pop" style={d(0.6 + i * 0.14)} />)}
      <circle cx={x(2)} cy={y(zafra[2])} r={11} fill={NARANJA} className="mm-pop" style={d(1.1)} />
      <circle cx={x(2)} cy={y(zafra[2])} r={20} fill="none" stroke={NARANJA} strokeWidth={1.5} className="mm-pulso" style={d(1.5)} />
      <text x={x(2) + 26} y={y(zafra[2]) - 10} className="mm-cifra mm-fade" style={d(1.8)}>PFI</text>
      <text x={x(2) + 26} y={y(zafra[2]) + 8} className="mm-etiqueta mm-fade" style={d(2)}>la caída que decide el mes</text>
      <text x={x(12)} y={y(ideal[12]) - 14} textAnchor="end" className="mm-etiqueta mm-fade" style={d(2.3)}>zafra ideal</text>
    </g>
  );
}

function Auditoria() {
  const cols = 9, filas = 5, paso = 46, x0 = 76, y0 = 108;
  // Los que la lupa encuentra, en el orden en que pasa (columna, fila, cuándo se encienden).
  const hallazgos: [number, number, number][] = [[2, 1, 1.35], [5, 3, 2.15], [7, 2, 2.75]];
  return (
    <g>
      {Array.from({ length: cols * filas }, (_, k) => {
        const c = k % cols, f = Math.floor(k / cols);
        return <circle key={k} cx={x0 + c * paso} cy={y0 + f * paso} r={7} fill={TINTA} fillOpacity={0.22} className="mm-pop" style={d(0.05 + (c + f) * 0.035)} />;
      })}
      {hallazgos.map(([c, f, t]) => (
        <g key={`${c}-${f}`}>
          <circle cx={x0 + c * paso} cy={y0 + f * paso} r={10} fill={ROJO} className="mm-pop" style={d(t)} />
          <circle cx={x0 + c * paso} cy={y0 + f * paso} r={20} fill="none" stroke={ROJO} strokeWidth={1.5} className="mm-pulso" style={d(t + 0.1)} />
        </g>
      ))}
      <g className="mm-lupa">
        <circle cx="0" cy="0" r="36" fill="rgba(255,255,255,0.35)" stroke={TINTA} strokeWidth={2.2} />
        <line x1="26" y1="26" x2="50" y2="50" stroke={TINTA} strokeWidth={3.2} strokeLinecap="round" />
      </g>
      <text x="480" y="372" textAnchor="end" className="mm-etiqueta mm-fade" style={d(3.1)}>3 vendedores para revisar</text>
    </g>
  );
}

const DIBUJOS: Record<string, () => JSX.Element> = {
  ventas: Ventas, productividad: Productividad, supervision: Supervision, facturacion: Facturacion, auditoria: Auditoria,
};

/* ------------------------------------------------------------------ panel */
function Palabras({ texto, desde = 0, className = "" }: { texto: string; desde?: number; className?: string }) {
  return (
    <span className={className}>
      {texto.split(" ").map((p, i) => (
        <span key={i} className="mm-palabra" style={d(desde + i * 0.08)}>{p}&nbsp;</span>
      ))}
    </span>
  );
}

export function PanelMarca() {
  const [i, setI] = useState(0);
  const [saliendo, setSaliendo] = useState(false);
  const panel = useRef<HTMLDivElement | null>(null);
  const escenario = useRef<HTMLDivElement | null>(null);
  const luz = useRef<HTMLDivElement | null>(null);

  // Ciclo de escenas contra un reloj fijo (sobrevive a montajes dobles y a pestañas en segundo plano): la escena y si
  // está saliendo se calculan del tiempo transcurrido, y el estado cambia solo cuando cambia el resultado.
  const t0 = useRef<number | null>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (t0.current == null) t0.current = performance.now();
    const id = setInterval(() => {
      const transcurrido = performance.now() - (t0.current ?? 0);
      const n = Math.floor(transcurrido / ESCENA_MS) % ESCENAS.length;
      const sale = transcurrido % ESCENA_MS > ESCENA_MS - SALIDA_MS;
      setI((v) => (v === n ? v : n));
      setSaliendo((v) => (v === sale ? v : sale));
    }, 80);
    return () => clearInterval(id);
  }, []);

  // Puntero: la ilustración se inclina apenas y una luz cálida lo sigue con retraso (resorte, sin re-render).
  useEffect(() => {
    const el = panel.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const obj = { x: 0.62, y: 0.5 }, act = { x: 0.62, y: 0.5 };
    let raf = 0;
    const mover = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      obj.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      obj.y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    };
    const tick = () => {
      act.x += (obj.x - act.x) * 0.06; act.y += (obj.y - act.y) * 0.06;
      if (luz.current) luz.current.style.transform = `translate(${act.x * 100}%, ${act.y * 100}%)`;
      if (escenario.current) {
        const rx = (0.5 - act.y) * 6, ry = (act.x - 0.5) * 8;
        escenario.current.style.transform = `perspective(1200px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
      }
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", mover, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("pointermove", mover); };
  }, []);

  const esc = ESCENAS[i];
  const Dibujo = DIBUJOS[esc.clave];

  return (
    <div ref={panel} className="mm-panel hidden lg:flex flex-col justify-between p-12 xl:p-16 relative overflow-hidden">
      <div className="mm-grano" aria-hidden />
      <div className="mm-luz-capa" aria-hidden><div ref={luz} className="mm-luz" /></div>

      {/* Marca */}
      <div className="relative z-10 flex items-center gap-3">
        <LogoAnimado size={58} marca={false} />
        <div className="leading-tight">
          <div className="font-display text-xl uppercase tracking-wide text-brand-ink">Operaciones <span className="text-brand-primary">Voicenter</span></div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">Gerencia Expansión RM</div>
        </div>
      </div>

      {/* Titular, y debajo la escena con su leyenda */}
      <div className="relative z-10">
        <h1 className="font-sans normal-case text-[46px] xl:text-[58px] leading-[1.04] font-light tracking-[-0.03em] text-brand-ink">
          <Palabras texto="Toda la operación," desde={0.1} />
          <br />
          <Palabras texto="en un solo lugar." desde={0.45} className="text-brand-primary font-normal" />
        </h1>

        <div className="mt-10 grid grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[250px_minmax(0,1fr)] gap-8 items-end">
          <div className="pb-6">
            <div className="h-[86px]">
              <div key={esc.clave} className={saliendo ? "mm-salir" : ""}>
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider2 font-semibold text-brand-slate">
                  <span className="mm-pop inline-block w-2 h-2 rounded-full bg-brand-primary" />
                  <span className="mm-palabra" style={d(0.05)}>{esc.nombre}</span>
                </div>
                <p className="mt-2 text-[17px] leading-snug text-brand-graphite"><Palabras texto={esc.frase} desde={0.15} /></p>
              </div>
            </div>
            <div className="mt-4 flex gap-1.5" aria-hidden>
              {ESCENAS.map((e, k) => (
                <span key={e.clave} className={`h-[3px] rounded-full transition-all duration-700 ${k === i ? "w-8 bg-brand-ink" : "w-3 bg-brand-ink/15"}`} />
              ))}
            </div>
          </div>

          <div ref={escenario} className="mm-escenario will-change-transform max-w-[620px] w-full justify-self-end">
            <svg viewBox="0 0 520 400" className="w-full h-auto overflow-visible" role="img" aria-label={esc.nombre}>
              <g key={esc.clave} className={saliendo ? "mm-salir" : ""}><Dibujo /></g>
            </svg>
          </div>
        </div>
      </div>

      {/* Pie */}
      <div className="relative z-10 flex items-end justify-between gap-6 text-[11px] uppercase tracking-wider2 text-brand-slate">
        <span>Operado por Voicenter S.A.</span>
        <span className="flex gap-5">
          {["Expansión", "Operaciones", "Indicadores", "Trazabilidad"].map((p) => <span key={p}>{p}</span>)}
        </span>
      </div>
    </div>
  );
}
