"use client";

/**
 * El resultado del IPV para leerlo de un vistazo: un medidor de la disposición general para la venta, los dos grandes
 * bloques (escucha y empuje) y cada factor como una escala de 10 segmentos con su significado en palabras simples.
 * El nivel siempre va escrito, no solo en color.
 */
import {
  BadgeCheck, ChevronDown, Gauge, HandHeart, Heart, Megaphone, Rocket, ShieldAlert, ShieldCheck, Shuffle, Sparkles, Swords,
  Target, Users, Zap, type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { cx } from "@/components/portal/ui";
import { NIVEL_IPV, type Escala, type NivelIpv, type ResultadoIpv } from "./tipos";

const CLARO: Record<NivelIpv, string> = { superior: "#DCFCE7", termino_medio: "#DBEAFE", inferior: "#FDE2E1" };
const FRASE: Record<NivelIpv, [string, string]> = {
  superior: ["Muy buen perfil vendedor", "Aprovechá sus fortalezas desde el primer día en piso."],
  termino_medio: ["Perfil vendedor adecuado", "Acompañalo en los factores más bajos."],
  inferior: ["Perfil a desarrollar", "Necesita acompañamiento cercano del mentor."],
};
/** Qué mide cada escala, en pocas palabras, y su ícono. */
const FACTOR: Record<string, { corto: string; icono: LucideIcon }> = {
  receptividad: { corto: "Escucha y empatía con el cliente", icono: HandHeart },
  agresividad: { corto: "Empuje para insistir y cerrar", icono: Rocket },
  comprension: { corto: "Entiende al cliente y su situación", icono: Heart },
  adaptabilidad: { corto: "Se adapta a personas y situaciones", icono: Shuffle },
  control: { corto: "Autocontrol, orden y constancia", icono: Gauge },
  tolerancia: { corto: "Aguanta el «no» sin bajarse", icono: ShieldCheck },
  combatividad: { corto: "Sostiene objeciones y desacuerdos", icono: Swords },
  dominancia: { corto: "Persuade e influye", icono: Megaphone },
  seguridad: { corto: "Confianza ante lo nuevo y el riesgo", icono: BadgeCheck },
  actividad: { corto: "Energía y dinamismo", icono: Zap },
  sociabilidad: { corto: "Facilidad para generar contactos", icono: Users },
};

/** Diez segmentos: llenos hasta el decatipo, en el color de su nivel. */
export function Escala10({ valor, nivel, chica }: { valor: number; nivel: NivelIpv; chica?: boolean }) {
  return (
    <span className={cx("inline-flex", chica ? "gap-[2px]" : "gap-[3px]")} aria-hidden>
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className={cx("rounded-[2px]", chica ? "w-[5px] h-3" : "w-[9px] h-4")}
          style={{ background: i < valor ? NIVEL_IPV[nivel].color : "#E6E8EC" }} />
      ))}
    </span>
  );
}

/** El DGV en una fila de la tabla: segmentos, número y nivel. */
export function MiniDgv({ decatipo, nivel }: { decatipo: number; nivel: NivelIpv }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px]" title={`Disposición general para la venta: ${decatipo} de 10 (${NIVEL_IPV[nivel].nombre})`}>
      <Escala10 valor={decatipo} nivel={nivel} chica />
      <b className="tabular-nums" style={{ color: NIVEL_IPV[nivel].color }}>{decatipo}</b>
      <span className="text-brand-slate">{NIVEL_IPV[nivel].nombre}</span>
    </span>
  );
}

/** Medidor semicircular de 10 segmentos. */
function Medidor({ valor, nivel }: { valor: number; nivel: NivelIpv }) {
  const cx0 = 100, cy0 = 100, r = 78, paso = 180 / 10, hueco = 1.6;
  const punto = (a: number) => [cx0 + r * Math.cos((a * Math.PI) / 180), cy0 - r * Math.sin((a * Math.PI) / 180)];
  return (
    <svg viewBox="0 0 200 118" className="w-full max-w-[240px]" role="img"
      aria-label={`Disposición general para la venta: ${valor} de 10, ${NIVEL_IPV[nivel].nombre}`}>
      {Array.from({ length: 10 }, (_, i) => {
        const [x1, y1] = punto(180 - i * paso - hueco);
        const [x2, y2] = punto(180 - (i + 1) * paso + hueco);
        return <path key={i} d={`M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`} fill="none" strokeWidth={20}
          stroke={i < valor ? NIVEL_IPV[nivel].color : "#E6E8EC"} />;
      })}
      <text x={100} y={92} textAnchor="middle" className="font-display" style={{ fontSize: 44, fill: "#0F1116" }}>{valor}</text>
      <text x={100} y={112} textAnchor="middle" style={{ fontSize: 11, fill: "#5B6573" }}>de 10</text>
      <text x={14} y={114} textAnchor="middle" style={{ fontSize: 10, fill: "#8A93A0" }}>1</text>
      <text x={186} y={114} textAnchor="middle" style={{ fontSize: 10, fill: "#8A93A0" }}>10</text>
    </svg>
  );
}

function FilaFactor({ x, descripcion }: { x: Escala; descripcion?: string }) {
  const [abierta, setAbierta] = useState(false);
  const f = FACTOR[x.clave];
  const I = f?.icono ?? Sparkles;
  return (
    <button type="button" onClick={() => setAbierta((v) => !v)} aria-expanded={abierta}
      className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-brand-bg-soft">
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: CLARO[x.nivel], color: NIVEL_IPV[x.nivel].color }}>
          <I size={18} aria-hidden strokeWidth={2.2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-brand-ink leading-tight">{x.nombre}</span>
          <span className="block text-[12px] text-brand-slate leading-snug">{f?.corto}</span>
        </span>
        <span className="shrink-0 text-right">
          <Escala10 valor={x.decatipo} nivel={x.nivel} />
          <span className="block text-[11px] font-semibold mt-0.5" style={{ color: NIVEL_IPV[x.nivel].color }}>{x.decatipo} · {NIVEL_IPV[x.nivel].nombre}</span>
        </span>
      </div>
      {abierta && descripcion && <p className="mt-2 ml-12 text-[13px] text-brand-slate leading-snug">{descripcion}</p>}
    </button>
  );
}

function Bloque({ titulo, total, factores, desc }: { titulo: string; total?: Escala; factores: Escala[]; desc: Record<string, string> }) {
  return (
    <div className="rounded-xl border border-brand-border overflow-hidden">
      <div className="px-3 py-2.5 bg-brand-bg-soft flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider2 font-bold text-brand-ink">{titulo}</div>
          {total && <div className="text-[12px] text-brand-slate">{FACTOR[total.clave]?.corto}</div>}
        </div>
        {total && (
          <span className="shrink-0 text-right">
            <Escala10 valor={total.decatipo} nivel={total.nivel} />
            <span className="block text-[11px] font-semibold mt-0.5" style={{ color: NIVEL_IPV[total.nivel].color }}>{total.decatipo} · {NIVEL_IPV[total.nivel].nombre}</span>
          </span>
        )}
      </div>
      <div className="divide-y divide-brand-border/70">{factores.map((x) => <FilaFactor key={x.clave} x={x} descripcion={desc[x.clave]} />)}</div>
    </div>
  );
}

export function PerfilIpv({ r, descripciones, pie }: { r: ResultadoIpv; descripciones: Record<string, string>; pie?: React.ReactNode }) {
  const de = (k: string) => r.escalas.find((x) => x.clave === k)!;
  const dgv = de("DGV");
  const grupo = (g: string) => r.escalas.filter((x) => x.grupo === g && x.romano);
  return (
    <div className="card overflow-hidden">
      {/* El veredicto */}
      <div className="p-4 sm:p-5 grid sm:grid-cols-[240px_1fr] gap-4 items-center" style={{ background: `linear-gradient(180deg, ${CLARO[dgv.nivel]}66, transparent)` }}>
        <div className="flex flex-col items-center">
          <Medidor valor={dgv.decatipo} nivel={dgv.nivel} />
          <span className="mt-1 inline-flex items-center rounded-full px-3 py-1 text-sm font-bold text-white" style={{ background: NIVEL_IPV[dgv.nivel].color }}>
            {NIVEL_IPV[dgv.nivel].nombre}
          </span>
        </div>
        <div className="min-w-0 space-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider2 font-semibold text-brand-slate">Disposición general para la venta</div>
            <p className="font-display text-2xl uppercase leading-tight text-brand-ink">{FRASE[dgv.nivel][0]}</p>
            <p className="text-[13px] text-brand-slate leading-snug">{FRASE[dgv.nivel][1]}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[de("receptividad"), de("agresividad")].map((x) => {
              const I = FACTOR[x.clave].icono;
              return (
                <div key={x.clave} className="rounded-lg bg-white border border-brand-border px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold text-brand-ink"><I size={14} aria-hidden />{x.clave === "receptividad" ? "Escucha" : "Empuje"}</div>
                  <div className="mt-1"><Escala10 valor={x.decatipo} nivel={x.nivel} chica /></div>
                  <div className="text-[11px] font-semibold mt-0.5" style={{ color: NIVEL_IPV[x.nivel].color }}>{x.decatipo} · {NIVEL_IPV[x.nivel].nombre}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-5 pb-4 space-y-3">
        {/* Fortalezas y a trabajar, como etiquetas */}
        <div className="flex flex-wrap gap-1.5">
          {r.fortalezas.map((n) => (
            <span key={n} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 px-2.5 py-1 text-[12px] font-semibold">
              <Sparkles size={12} aria-hidden /> {n}
            </span>
          ))}
          {r.a_trabajar.map((n) => (
            <span key={n} className="inline-flex items-center gap-1 rounded-full bg-brand-primary-light border border-brand-primary/25 text-brand-primary-dark px-2.5 py-1 text-[12px] font-semibold">
              <Target size={12} aria-hidden /> A trabajar: {n}
            </span>
          ))}
        </div>
        {r.senales.length > 0 && (
          <div className="rounded-lg border border-brand-orange/40 bg-brand-orange/10 px-3 py-2.5 text-[13px] text-[#8A5200] space-y-1">
            {r.senales.map((s) => <p key={s} className="flex gap-2"><ShieldAlert size={15} className="shrink-0 mt-0.5" aria-hidden />{s}</p>)}
          </div>
        )}
        <Bloque titulo="Escucha · receptividad" total={de("receptividad")} factores={grupo("receptividad")} desc={descripciones} />
        <Bloque titulo="Empuje · agresividad comercial" total={de("agresividad")} factores={grupo("agresividad").filter((x) => x.clave !== "sociabilidad")} desc={descripciones} />
        <Bloque titulo="Relación" factores={[de("sociabilidad")]} desc={descripciones} />
        <p className="text-[11px] text-brand-mist flex items-center gap-1"><ChevronDown size={12} aria-hidden /> Tocá un factor para ver qué mide.</p>
        {pie}
      </div>
    </div>
  );
}
