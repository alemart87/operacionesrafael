"use client";

/** El mural de puntos de la fachada, vivo (login). Cada pelota es una partícula en un canvas:
 *  - En reposo forman la grilla del mural; cada tanto migran con resortes a una forma del negocio (columnas de
 *    ventas, la zafra con la PFI en M2, el embudo llamadas → contactos → ventas, el isotipo de Voicenter, un mix) y
 *    vuelven.
 *  - El puntero es una lente: las pelotas cercanas se apartan y se encienden al color de marca; quieto un instante,
 *    se alinean en anillos alrededor del cursor; un clic las empuja con una onda.
 *  - Tres capas con parallax contra el mouse dan profundidad.
 *  Sin dependencias. Se pausa fuera de pantalla o con la pestaña oculta; con `prefers-reduced-motion` queda la
 *  grilla quieta con el puntero suave. */
import { useEffect, useRef } from "react";
import { PUNTOS } from "@/components/voi/VoiIsotipo";

const BLANCO = "#FFFFFF", CIAN = "#00B2BF", VIOLETA = "#662483", NARANJA = "#F39200", AMARILLO = "#FFD400";
const COLORES_MURAL = [BLANCO, CIAN, VIOLETA, NARANJA, BLANCO, AMARILLO, BLANCO, CIAN];
const COLS = 26, FILAS = 11;
const N = COLS * FILAS;                       // 286 partículas: la grilla completa; cada forma usa las que necesita
const CICLO_MS = 7600;                        // cuánto dura cada forma
const GRILLA_MS = 9000;                       // la grilla (reposo) dura un poco más
const RADIO_PUNTERO = 130, RADIO_ANILLOS = 170, PASO_ANILLO = 26, QUIETO_MS = 900;

type Objetivo = { x: number; y: number; color: string; r: number; a: number };
type Particula = { x: number; y: number; vx: number; vy: number; color: string; r: number; a: number; capa: number; o: Objetivo };
type Forma = { nombre: string; leyenda: string; puntos: (w: number, h: number) => Objetivo[] };

const hex2rgb = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)] as const;
const RGB: Record<string, readonly [number, number, number]> = Object.fromEntries([BLANCO, CIAN, VIOLETA, NARANJA, AMARILLO].map((c) => [c, hex2rgb(c)]));

/** Altura de cada columna del mural (una onda, como el ecualizador de la fachada), igual que en MuralPuntos. */
function alturaColumna(c: number): number {
  const onda = Math.sin(c * 0.9) * 2.4 + Math.sin(c * 0.37 + 1.3) * 1.8;
  return Math.max(2, Math.min(FILAS, Math.round(6 + onda)));
}

/** El escenario donde se dibujan las formas de datos: centro-derecha, lejos del texto (abajo a la izquierda) y del logo. */
function escenario(w: number, h: number) {
  return { x0: w * 0.52, y0: h * 0.36, x1: w * 0.96, y1: h * 0.90 };
}

function rellenar(puntos: Objetivo[], w: number, h: number): Objetivo[] {
  // Las partículas que una forma no usa se esconden repartidas por el fondo (alpha 0), así no "saltan" al volver.
  const out = puntos.slice(0, N);
  let i = out.length;
  while (out.length < N) {
    const c = i % COLS, f = Math.floor(i / COLS) % FILAS;
    out.push({ x: (c + 0.5) * (w / COLS), y: (f + 0.5) * (h / FILAS), color: COLORES_MURAL[(c * 3 + f * 5) % COLORES_MURAL.length], r: 0, a: 0 });
    i++;
  }
  return out;
}

const FORMAS: Forma[] = [
  {
    nombre: "grilla", leyenda: "",
    puntos: (w, h) => {
      const paso = Math.max(w / COLS, h / FILAS);
      const r = paso * 0.31;
      const out: Objetivo[] = [];
      for (let c = 0; c < COLS; c++) {
        const n = alturaColumna(c), desde = Math.floor((FILAS - n) / 2);
        for (let f = 0; f < FILAS; f++) {
          const activo = f >= desde && f < desde + n;
          out.push({ x: paso / 2 + c * paso, y: paso / 2 + f * paso, color: COLORES_MURAL[(c * 3 + f * 5) % COLORES_MURAL.length], r: activo ? r : 0, a: activo ? 1 : 0 });
        }
      }
      return out;
    },
  },
  {
    nombre: "columnas", leyenda: "Ventas por mes · 12 meses",
    puntos: (w, h) => {
      const e = escenario(w, h), ancho = e.x1 - e.x0, alto = e.y1 - e.y0;
      const meses = 12, cols = [7, 8, 8, 9, 10, 9, 11, 12, 11, 13, 14, 15];
      const out: Objetivo[] = [];
      const paso = ancho / meses, r = Math.min(paso * 0.28, alto / 18 / 2.3);
      for (let m = 0; m < meses; m++) {
        for (let k = 0; k < cols[m]; k++) {
          out.push({ x: e.x0 + paso * (m + 0.5), y: e.y1 - k * (alto / 17), color: k === cols[m] - 1 ? CIAN : m >= 9 ? NARANJA : BLANCO, r, a: 1 });
        }
      }
      return out;
    },
  },
  {
    nombre: "zafra", leyenda: "Zafra · líneas activas por mes · M2 = PFI",
    puntos: (w, h) => {
      const e = escenario(w, h), ancho = e.x1 - e.x0, alto = e.y1 - e.y0;
      const zafra = [99.9, 82.6, 58.5, 53.8, 53.1, 49.2, 51.1, 46.2, 41.9, 40.7, 40.1, 40.4, 41.8];
      const ideal = [99.9, 82.6, 75, 70, 67, 63, 60, 58, 56, 54, 53, 51, 49];
      const out: Objetivo[] = [];
      const r = Math.min(ancho / 60, alto / 40);
      const curva = (serie: number[], color: string, grosor: number, porSeg: number) => {
        for (let i = 0; i < serie.length - 1; i++) {
          for (let s = 0; s < porSeg; s++) {
            const t = s / porSeg;
            const x = e.x0 + (ancho * (i + t)) / (serie.length - 1);
            const y = e.y1 - (alto * (serie[i] + (serie[i + 1] - serie[i]) * t)) / 100;
            for (let g = 0; g < grosor; g++) out.push({ x, y: y + (g - (grosor - 1) / 2) * r * 1.4, color, r, a: 1 });
          }
        }
      };
      curva(ideal, CIAN, 1, 5);
      curva(zafra, BLANCO, 2, 6);
      // La PFI: el escalón M1 → M2, marcado.
      const xm2 = e.x0 + (ancho * 2) / 12, ym2 = e.y1 - (alto * zafra[2]) / 100;
      for (let k = 0; k < 8; k++) out.push({ x: xm2 + Math.cos((k / 8) * Math.PI * 2) * r * 3.2, y: ym2 + Math.sin((k / 8) * Math.PI * 2) * r * 3.2, color: NARANJA, r: r * 0.9, a: 1 });
      // Eje de meses.
      for (let m = 0; m <= 12; m++) out.push({ x: e.x0 + (ancho * m) / 12, y: e.y1 + r * 3, color: BLANCO, r: r * 0.5, a: 0.6 });
      return out;
    },
  },
  {
    nombre: "embudo", leyenda: "Llamadas → contactos → ventas",
    puntos: (w, h) => {
      const e = escenario(w, h), ancho = e.x1 - e.x0, alto = e.y1 - e.y0;
      const niveles = [{ n: 40, color: BLANCO, filas: 3 }, { n: 22, color: CIAN, filas: 2 }, { n: 9, color: NARANJA, filas: 2 }];
      const out: Objetivo[] = [];
      const r = Math.min(ancho / 90, alto / 30);
      let y = e.y0 + alto * 0.12;
      for (const niv of niveles) {
        const total = niv.n * r * 2.6, x0 = e.x0 + (ancho - total) / 2;
        for (let f = 0; f < niv.filas; f++) {
          for (let k = 0; k < niv.n; k++) out.push({ x: x0 + k * r * 2.6 + r * 1.3, y: y + f * r * 2.6, color: niv.color, r, a: 1 });
        }
        y += niv.filas * r * 2.6 + alto * 0.14;
      }
      return out;
    },
  },
  {
    nombre: "isotipo", leyenda: "",
    puntos: (w, h) => {
      const e = escenario(w, h), ancho = e.x1 - e.x0, alto = e.y1 - e.y0;
      const paso = Math.min(ancho / 9, alto / 9);
      const cx = (e.x0 + e.x1) / 2 - paso * 3, cy = (e.y0 + e.y1) / 2 - paso * 3.5;
      const out: Objetivo[] = [];
      for (const [col, fila, color] of PUNTOS) {
        const c = color === "#E6332A" ? BLANCO : color;
        // Cada punto del isotipo se arma con 4 partículas (así se ve macizo).
        for (let k = 0; k < 4; k++) {
          const ang = (k / 4) * Math.PI * 2;
          out.push({ x: cx + col * paso + Math.cos(ang) * paso * 0.12, y: cy + fila * paso * 0.92 + Math.sin(ang) * paso * 0.12, color: c, r: paso * 0.3, a: 1 });
        }
      }
      return out;
    },
  },
  {
    nombre: "mix", leyenda: "Mix de planes · CG15G 58 % · CG30G 39 % · otros",
    puntos: (w, h) => {
      const e = escenario(w, h), ancho = e.x1 - e.x0, alto = e.y1 - e.y0;
      const cx = (e.x0 + e.x1) / 2, cy = (e.y0 + e.y1) / 2, R = Math.min(ancho, alto) * 0.36;
      const partes = [{ p: 0.58, color: BLANCO }, { p: 0.39, color: CIAN }, { p: 0.03, color: NARANJA }];
      const out: Objetivo[] = [];
      const total = 150; let ang = -Math.PI / 2;
      const r = R * 0.075;
      for (const parte of partes) {
        const n = Math.max(3, Math.round(total * parte.p));
        for (let k = 0; k < n; k++) {
          const a = ang + ((k + 0.5) / n) * parte.p * Math.PI * 2;
          for (let g = 0; g < 2; g++) out.push({ x: cx + Math.cos(a) * (R - g * r * 2.4), y: cy + Math.sin(a) * (R - g * r * 2.4), color: parte.color, r, a: 1 });
        }
        ang += parte.p * Math.PI * 2;
      }
      return out;
    },
  },
];

export function MuralVivo({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0, h = 0, dpr = 1;
    const particulas: Particula[] = [];
    let forma = 0, formaDesde = performance.now(), leyendaAlpha = 0;
    const puntero = { x: -9999, y: -9999, dentro: false, quietoDesde: 0, ultimoMov: 0 };
    const ondas: { x: number; y: number; t0: number }[] = [];
    const parallax = { x: 0, y: 0 };
    let corriendo = true, visible = true, raf = 0, ultimo = performance.now();

    const aplicarForma = (i: number) => {
      const objetivos = rellenar(FORMAS[i].puntos(w, h), w, h);
      // Las partículas se reparten por cercanía: cada una va al objetivo más próximo que quede libre (barato: por orden
      // en la grilla, con un desplazamiento según la forma para que no siempre viaje la misma).
      const desplaz = (i * 37) % N;
      for (let k = 0; k < N; k++) particulas[k].o = objetivos[(k + desplaz) % N];
    };

    const inicializar = () => {
      const base = rellenar(FORMAS[0].puntos(w, h), w, h);
      particulas.length = 0;
      for (let k = 0; k < N; k++) {
        const o = base[k];
        particulas.push({ x: o.x, y: o.y, vx: 0, vy: 0, color: o.color, r: o.r, a: o.a, capa: k % 3, o });
      }
      forma = 0; formaDesde = performance.now();
    };

    const redimensionar = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, Math.round(rect.width)); h = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (particulas.length) aplicarForma(forma); else inicializar();
    };
    redimensionar();
    const ro = new ResizeObserver(redimensionar);
    ro.observe(canvas);

    // ---- puntero: lente, anillos al quedarse quieto, onda al hacer clic ----
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      puntero.dentro = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
      if (!puntero.dentro) return;
      if (Math.hypot(x - puntero.x, y - puntero.y) > 2) puntero.ultimoMov = performance.now();
      puntero.x = x; puntero.y = y;
      parallax.x = (x / rect.width - 0.5) * 2; parallax.y = (y / rect.height - 0.5) * 2;
    };
    const onLeave = () => { puntero.dentro = false; puntero.x = -9999; puntero.y = -9999; };
    const onDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) { ondas.push({ x, y, t0: performance.now() }); if (ondas.length > 4) ondas.shift(); }
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    document.addEventListener("pointerleave", onLeave);

    // ---- pausa fuera de pantalla / pestaña oculta ----
    const io = new IntersectionObserver((es) => { visible = es.some((x) => x.isIntersecting); }, { threshold: 0.05 });
    io.observe(canvas);
    const onVis = () => { corriendo = document.visibilityState === "visible"; if (corriendo) { ultimo = performance.now(); raf = requestAnimationFrame(paso); } };
    document.addEventListener("visibilitychange", onVis);

    const paso = (ahora: number) => {
      if (!corriendo) return;
      raf = requestAnimationFrame(paso);
      if (!visible) return;
      const dt = Math.min(0.05, (ahora - ultimo) / 1000); ultimo = ahora;

      // Cambio de forma (no en modo reducido: la grilla queda quieta).
      if (!reducido) {
        const dura = forma === 0 ? GRILLA_MS : CICLO_MS;
        if (ahora - formaDesde > dura) { forma = (forma + 1) % FORMAS.length; formaDesde = ahora; aplicarForma(forma); }
      }
      const leyenda = FORMAS[forma].leyenda;
      const faseForma = (ahora - formaDesde) / 1000;
      leyendaAlpha += ((leyenda && faseForma > 0.9 ? 1 : 0) - leyendaAlpha) * Math.min(1, dt * 3);

      const quieto = puntero.dentro && ahora - puntero.ultimoMov > QUIETO_MS;
      const anillosFuerza = quieto ? Math.min(1, (ahora - puntero.ultimoMov - QUIETO_MS) / 700) : 0;

      ctx.clearRect(0, 0, w, h);
      const k = 1 - Math.exp(-dt * 7);      // resorte crítico (sin oscilar)
      for (const p of particulas) {
        const o = p.o;
        // Parallax por capa: las capas lejanas se mueven poco y al revés del mouse.
        const prof = (p.capa - 1) * 10;
        let tx = o.x + parallax.x * prof, ty = o.y + parallax.y * prof;
        let tr = o.r * (1 + (p.capa - 1) * 0.12), ta = o.a * (0.75 + p.capa * 0.12);
        let color = o.color, luz = 0;
        // Puntero: lente que aparta y enciende; quieto, anillos concéntricos.
        const dx = p.x - puntero.x, dy = p.y - puntero.y, d = Math.hypot(dx, dy);
        if (puntero.dentro && d < RADIO_ANILLOS && o.a > 0) {
          if (d < RADIO_PUNTERO) {
            const f = 1 - d / RADIO_PUNTERO;
            const empuje = (1 - anillosFuerza) * f * f * 34;
            tx += (dx / (d || 1)) * empuje; ty += (dy / (d || 1)) * empuje;
            luz = f;
          }
          if (anillosFuerza > 0) {
            const anillo = Math.max(PASO_ANILLO, Math.round(d / PASO_ANILLO) * PASO_ANILLO);
            const ax = puntero.x + (dx / (d || 1)) * anillo, ay = puntero.y + (dy / (d || 1)) * anillo;
            tx += (ax - tx) * anillosFuerza; ty += (ay - ty) * anillosFuerza;
            luz = Math.max(luz, anillosFuerza * (1 - d / RADIO_ANILLOS) * 0.8);
          }
        }
        // Ondas de los clics: un pulso que empuja y se apaga.
        for (const onda of ondas) {
          const t = (ahora - onda.t0) / 1000;
          if (t > 1.4) continue;
          const frente = t * 420, ox = p.x - onda.x, oy = p.y - onda.y, od = Math.hypot(ox, oy);
          const cerca = Math.exp(-((od - frente) * (od - frente)) / (2 * 40 * 40)) * (1 - t / 1.4);
          tx += (ox / (od || 1)) * cerca * 40; ty += (oy / (od || 1)) * cerca * 40;
          luz = Math.max(luz, cerca);
        }
        if (luz > 0) { tr *= 1 + luz * 0.6; ta = Math.min(1, ta + luz * 0.6); if (p.color === BLANCO && luz > 0.35) color = CIAN; }
        p.x += (tx - p.x) * k; p.y += (ty - p.y) * k;
        p.r += (tr - p.r) * k; p.a += (ta - p.a) * k;
        p.color = o.color;
        if (p.a < 0.02 || p.r < 0.3) continue;
        const [cr, cg, cb] = RGB[color] ?? RGB[BLANCO];
        ctx.beginPath();
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${p.a})`;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      while (ondas.length && ahora - ondas[0].t0 > 1400) ondas.shift();

      // Leyenda de la forma, discreta, abajo a la derecha del escenario.
      if (leyendaAlpha > 0.02 && leyenda) {
        const e = escenario(w, h);
        ctx.font = "600 11px Manrope, system-ui, sans-serif";
        ctx.textAlign = "right"; ctx.textBaseline = "alphabetic";
        ctx.fillStyle = `rgba(255,255,255,${0.75 * leyendaAlpha})`;
        ctx.fillText(leyenda.toUpperCase(), e.x1, Math.min(h - 12, e.y1 + 34));
      }
    };
    raf = requestAnimationFrame(paso);

    return () => {
      corriendo = false;
      cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden />;
}
