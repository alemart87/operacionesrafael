"use client";

/**
 * El lienzo de Voi: lo que Voi mostró en la conversación (gráficos, indicadores, tablas y tableros), en grande, al lado
 * del chat. En pantallas anchas ocupa el espacio de la página; en tablet y teléfono, la pantalla completa. Cada pieza se
 * puede ver como gráfico o como tabla de datos y descargar en CSV o PNG.
 *
 * En modo auditor o informe diario el lienzo lleva el borde del modo y cada pieza (o cada parte de un tablero) se puede
 * elegir para sumarla como figura al informe destino; las que ya están en el informe muestran su número.
 */
import {
  ArrowLeft, BarChart3, Check, CheckCircle2, Download, FileImage, LayoutDashboard, Lock, Plus, Sparkles, Table2, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { descargarCsv } from "@/lib/csv";
import { esInformeDiario, etiquetaDestino, tieneDestino } from "@/lib/voi";
import { aNumero } from "@/lib/voiFormato";
import { FranjaAuditor, HojaSumar, type PiezaElegida, useIndiceDestino } from "../VoiAuditor";
import { useVoi } from "../VoiProvider";
import { ICONO_TIPO, NOMBRE_TIPO } from "./iconos";
import { pngPiezaDe } from "./captura";
import { ArtefactoVoi, PiezaVoi, nombreX } from "./tipos";
import { CuerpoPieza } from "./VoiGrafico";

export { ICONO_TIPO, NOMBRE_TIPO };
export { pngBlobDe, pngPiezaDe } from "./captura";

/** Elegir una pieza para sumarla al informe (modo auditor). */
export interface EleccionPieza {
  elegida: boolean;
  alternar: () => void;
  /** Por qué no se puede sumar (p. ej. usa datos confidenciales de Facturación). */
  bloqueo?: string | null;
  /** Ya está en el informe destino con este número de figura. */
  figura?: number | null;
  /** El destino es el informe diario (el botón lo dice). */
  diario?: boolean;
}

const CONFIDENCIAL = "Sale de una conversación que usó datos de Facturación (confidenciales): no puede ir a un informe.";

/** «Agregar al informe diario» (elegir la pieza), «Elegida», «Figura N» (ya está en el informe) o «Confidencial».
 * Misma altura que los botones de la barra (Datos, CSV, PNG). */
function BotonEleccion({ e }: { e: EleccionPieza }) {
  const base = "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-[5px] text-xs font-semibold";
  const destino = e.diario ? "informe diario" : "informe";
  if (e.bloqueo) {
    return <span title={e.bloqueo} className={`${base} border-brand-border bg-brand-bg text-brand-slate`}><Lock size={12} /> Confidencial</span>;
  }
  if (e.figura) {
    return (
      <span title="Ya está en el informe destino" className={`${base} border-emerald-200 bg-emerald-50 text-emerald-700`}>
        <CheckCircle2 size={13} /> Figura {e.figura}
      </span>
    );
  }
  return (
    <button type="button" onClick={e.alternar} aria-pressed={e.elegida}
      title={e.elegida ? `Quitar de lo que va al ${destino}` : `Elegir para agregar al ${destino}`}
      className={`${base} transition-colors ${e.elegida
        ? "border-brand-ink bg-brand-ink text-white hover:bg-brand-graphite"
        : "border-brand-primary/40 bg-brand-primary-light/40 text-brand-primary-dark hover:border-brand-primary hover:bg-brand-primary-light"}`}>
      {e.elegida ? <Check size={13} /> : <Plus size={13} />} {e.elegida ? "Elegida" : `Agregar al ${destino}`}
    </button>
  );
}

function nombreArchivo(t: string) {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60) || "voi";
}

function csvDe(spec: PiezaVoi) {
  if (spec.tipo === "kpis") {
    descargarCsv(`${nombreArchivo(spec.titulo)}.csv`, ["Indicador", "Valor", "Variación %", "Detalle"],
      (spec.kpis ?? []).map((k) => [k.titulo, k.valor, k.variacion ?? null, k.detalle ?? ""]));
    return;
  }
  const columnas = spec.columnas ?? (spec.x ? [{ campo: spec.x, nombre: nombreX(spec) }, ...(spec.series ?? []).map((s) => ({ campo: s.campo, nombre: s.nombre }))] : []);
  descargarCsv(`${nombreArchivo(spec.titulo)}.csv`, columnas.map((c) => c.nombre),
    (spec.datos ?? []).map((f) => columnas.map((c) => {
      const v = f[c.campo];
      if (typeof v === "number" || v === null || v === undefined) return v;
      const n = (c as any).crudo ? null : aNumero(v);
      return n ?? String(v);
    })));
}

/** Descargar la pieza como PNG (el tablero completo, el gráfico, los indicadores, la tabla o la dona). */
async function pngDe(contenedor: HTMLElement | null, spec: PiezaVoi) {
  const blob = await pngPiezaDe(contenedor, spec);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: `${nombreArchivo(spec.titulo)}.png` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function BotonChico({ onClick, titulo, children, activo }: { onClick: () => void; titulo: string; children: React.ReactNode; activo?: boolean }) {
  return (
    <button type="button" onClick={onClick} title={titulo}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
        activo ? "bg-brand-ink text-white" : "text-brand-slate hover:bg-brand-bg hover:text-brand-ink"}`}>
      {children}
    </button>
  );
}

/** Una pieza con su título, su lectura, el cambio a tabla de datos y las descargas (y, en modo auditor, «Al informe»). */
export function PiezaLienzo({ spec, compacto = false, eleccion, eleccionDe }: {
  spec: PiezaVoi;
  compacto?: boolean;
  eleccion?: EleccionPieza;
  /** Para un tablero: la elección de cada una de sus partes. */
  eleccionDe?: (i: number) => EleccionPieza | undefined;
}) {
  const [verDatos, setVerDatos] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const grafico = !["kpis", "tabla", "tablero"].includes(spec.tipo);
  return (
    <div className={`rounded-2xl border bg-white transition-shadow ${compacto ? "p-4" : "p-5"} ${
      eleccion?.elegida ? "border-brand-ink shadow-elevated" : "border-brand-border"}`}>
      <div className="flex flex-wrap items-start gap-2">
        {/* Con poco ancho, la barra de botones baja debajo del título (el título nunca queda aplastado). */}
        <div className="min-w-[11rem] flex-1">
          <h3 className={`font-semibold text-brand-ink leading-snug ${compacto ? "text-sm" : "text-base"}`}>{spec.titulo}</h3>
          {spec.descripcion && <p className="mt-0.5 text-sm text-brand-slate leading-snug">{spec.descripcion}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-0.5 no-print">
          {eleccion && <span className="mr-1"><BotonEleccion e={eleccion} /></span>}
          {grafico && (
            <BotonChico titulo={verDatos ? "Ver el gráfico" : "Ver los datos en una tabla"} onClick={() => setVerDatos(!verDatos)} activo={verDatos}>
              <Table2 size={13} /> Datos
            </BotonChico>
          )}
          {spec.tipo !== "tablero" && <BotonChico titulo="Descargar CSV (Excel)" onClick={() => csvDe(spec)}><Download size={13} /> CSV</BotonChico>}
          {!verDatos && (
            <BotonChico titulo="Descargar imagen PNG" onClick={() => pngDe(caja.current, spec)}><FileImage size={13} /> PNG</BotonChico>
          )}
        </div>
      </div>
      <div ref={caja} className="mt-4">
        {spec.tipo === "tablero" ? <Tablero spec={spec} eleccionDe={eleccionDe} /> : <CuerpoPieza spec={spec} verDatos={verDatos} compacto={compacto} />}
      </div>
      {spec.nota && <p className="mt-3 text-[11px] text-brand-mist">{spec.nota}</p>}
    </div>
  );
}

function Tablero({ spec, eleccionDe }: { spec: PiezaVoi; eleccionDe?: (i: number) => EleccionPieza | undefined }) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {(spec.widgets ?? []).map((w, i) => (
        <div key={i} data-widget={i} className={w.tipo === "kpis" || w.tipo === "tabla" || (spec.widgets ?? []).length === 1 ? "xl:col-span-2" : ""}>
          <PiezaLienzo spec={w} compacto eleccion={eleccionDe?.(i)} />
        </div>
      ))}
    </div>
  );
}

export function VoiLienzo() {
  const voi = useVoi()!;
  const artefactos: ArtefactoVoi[] = useMemo(() => [...voi.chat.artefactos, ...voi.lienzo.locales], [voi.chat.artefactos, voi.lienzo.locales]);
  const sel = artefactos.find((a) => a.id === voi.lienzo.foco) ?? artefactos[artefactos.length - 1];
  const chips = useRef<HTMLDivElement>(null);
  const inv = voi.investigacion;
  const diario = esInformeDiario(inv);
  const etiqueta = etiquetaDestino(inv);
  const { indice, recargar } = useIndiceDestino(inv);
  // Claves elegidas para el informe («id» o «id#n» para una parte de un tablero), en el orden en que se eligieron.
  const [elegidas, setElegidas] = useState<string[]>([]);
  const [hoja, setHoja] = useState(false);

  useEffect(() => { setElegidas([]); }, [voi.conv?.id, inv?.auditoria_id, inv?.informe_id, inv?.activo]);
  // Lo que Voi suma al informe con su tarjeta también se marca acá (se vuelve a pedir el índice).
  const sumadasPorVoi = voi.chat.items.filter((i) => i.tipo === "accion" && i.accion.herramienta === "proponer_evidencia" && i.accion.estado === "ejecutada").length;
  const previas = useRef(sumadasPorVoi);
  useEffect(() => {
    if (sumadasPorVoi !== previas.current) recargar();
    previas.current = sumadasPorVoi;
  }, [sumadasPorVoi, recargar]);

  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape" && !hoja && !voi.selectorAuditor) voi.cerrarLienzo(); };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [voi, hoja]);
  useEffect(() => {
    chips.current?.querySelector("[aria-current=true]")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [sel?.id]);

  const figuras = useMemo(() => new Map((indice?.figuras ?? []).filter((f) => f.artefacto_id).map((f) => [f.artefacto_id!, f.figura])), [indice]);
  const alternar = useCallback((clave: string) => setElegidas((l) => (l.includes(clave) ? l.filter((x) => x !== clave) : [...l, clave])), []);
  const eleccion = (a: ArtefactoVoi, widget?: number): EleccionPieza | undefined => {
    if (!inv) return undefined;
    const clave = widget === undefined ? a.id : `${a.id}#${widget}`;
    return {
      elegida: elegidas.includes(clave), alternar: () => alternar(clave),
      bloqueo: a.confidencial ? CONFIDENCIAL : null, figura: a.local ? null : figuras.get(clave) ?? null, diario,
    };
  };
  const piezasElegidas: PiezaElegida[] = elegidas.flatMap((clave) => {
    const [id, parte] = clave.split("#");
    const a = artefactos.find((x) => x.id === id);
    if (!a) return [];
    const widget = parte === undefined ? null : Number(parte);
    const spec = widget === null ? a.spec : a.spec.widgets?.[widget];
    return spec ? [{ clave, artefacto: a, widget, spec }] : [];
  });
  const elegidasDe = (a: ArtefactoVoi) => elegidas.filter((c) => c === a.id || c.startsWith(`${a.id}#`)).length;

  return (
    <section
      className={`voi-lienzo-entra no-print fixed z-[45] inset-0 lg:right-[440px] bg-brand-bg flex flex-col lg:border-r border-brand-border ${inv ? (diario ? "voi-informe" : "voi-auditor") : ""}`}
      role="dialog"
      aria-label="Lienzo de Voi"
    >
      <div className="flex items-center gap-3 px-4 h-14 flex-shrink-0 bg-white border-b border-brand-border pt-[env(safe-area-inset-top)] box-content">
        <button type="button" onClick={voi.cerrarLienzo} className="lg:hidden w-9 h-9 grid place-items-center rounded-lg text-brand-slate hover:bg-brand-bg" aria-label="Volver al chat">
          <ArrowLeft size={18} />
        </button>
        <LayoutDashboard size={20} className="text-brand-primary hidden lg:block" />
        <div className="leading-none min-w-0">
          <div className="font-display text-xl text-brand-ink tracking-wide">Lienzo</div>
          <div className="text-[9px] uppercase tracking-[0.16em] text-brand-slate mt-1 font-semibold truncate">
            {voi.conv?.titulo ? `Lo que Voi mostró · ${voi.conv.titulo}` : "Lo que Voi mostró en esta conversación"}
          </div>
        </div>
        <button type="button" onClick={voi.cerrarLienzo} className="ml-auto w-9 h-9 grid place-items-center rounded-lg text-brand-slate hover:bg-brand-bg hover:text-brand-ink" aria-label="Cerrar el lienzo (Esc)" title="Cerrar el lienzo (Esc)">
          <X size={18} />
        </button>
      </div>
      {inv && <FranjaAuditor inv={inv} onCambiar={() => voi.setSelectorAuditor(true)} />}
      {artefactos.length > 1 && (
        <div ref={chips} className="flex gap-2 overflow-x-auto px-4 py-2.5 bg-white border-b border-brand-border flex-shrink-0">
          {artefactos.map((a) => {
            const Icono = ICONO_TIPO[a.tipo] ?? BarChart3;
            const activo = a.id === sel?.id;
            const marcadas = inv ? elegidasDe(a) : 0;
            const enInforme = inv && !a.local && figuras.has(a.id);
            return (
              <button key={a.id} type="button" aria-current={activo} onClick={() => voi.abrirLienzo(a.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs whitespace-nowrap max-w-[260px] transition-colors ${
                  activo ? "border-brand-ink bg-brand-ink text-white" : "border-brand-border bg-white text-brand-graphite hover:border-brand-ink/40"}`}>
                <Icono size={13} className="flex-shrink-0" />
                <span className="truncate">{a.titulo}</span>
                {marcadas > 0 && (
                  <span className={`ml-0.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold grid place-items-center ${activo ? "bg-white text-brand-ink" : "bg-brand-ink text-white"}`}>{marcadas}</span>
                )}
                {!marcadas && enInforme && <CheckCircle2 size={12} className={activo ? "text-emerald-300" : "text-emerald-600"} aria-label="En el informe" />}
                {inv && a.confidencial && <Lock size={11} className="opacity-60" aria-label="Confidencial" />}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex-1 overflow-y-auto overscroll-contain p-4 lg:p-6">
        <div className="max-w-5xl mx-auto">
          {sel ? (
            <PiezaLienzo key={sel.id} spec={sel.spec} eleccion={eleccion(sel)}
              eleccionDe={sel.spec.tipo === "tablero" ? (i) => eleccion(sel, i) : undefined} />
          ) : <Vacio />}
        </div>
      </div>
      {inv && artefactos.length > 0 && (
        <div className="flex-shrink-0 border-t border-brand-border bg-white px-4 lg:px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex items-center gap-3">
          <div className="min-w-0 flex-1 leading-snug">
            {elegidas.length ? (
              <>
                <div className="text-sm font-semibold text-brand-ink">{elegidas.length === 1 ? "1 pieza elegida" : `${elegidas.length} piezas elegidas`}</div>
                <div className="text-xs text-brand-slate truncate">
                  Para <span className="whitespace-nowrap">{etiqueta ?? "el informe"}</span>{indice ? ` · tiene ${indice.figuras.length} figura${indice.figuras.length === 1 ? "" : "s"}` : ""}
                </div>
              </>
            ) : (
              <div className="text-xs text-brand-slate">
                Tocá <span className="font-semibold text-brand-ink">Agregar al {diario ? "informe diario" : "informe"}</span> en lo que quieras sumar
                {etiqueta ? <> a <span className="whitespace-nowrap">{etiqueta}</span></> : ""}.
              </div>
            )}
          </div>
          {elegidas.length > 0 && <button type="button" onClick={() => setElegidas([])} className="btn-ghost px-3 py-2 text-xs">Limpiar</button>}
          {tieneDestino(inv) ? (
            <button type="button" onClick={() => setHoja(true)} disabled={!elegidas.length || indice?.informe.editable === false}
              title={indice?.informe.editable === false ? (diario ? "El informe ya está firmado: sus figuras quedaron fijas" : "El informe está cerrado: su evidencia quedó fija") : undefined}
              className="btn-primary px-4 py-2 whitespace-nowrap">{diario ? "Agregar al informe diario" : "Agregar al informe"}</button>
          ) : (
            <button type="button" onClick={() => voi.setSelectorAuditor(true)} className="btn-primary px-4 py-2 whitespace-nowrap">Elegir informe</button>
          )}
        </div>
      )}
      {hoja && inv && tieneDestino(inv) && (
        <HojaSumar piezas={piezasElegidas} inv={inv} indice={indice} conversacionId={voi.conv?.id ?? null}
          onCerrar={() => setHoja(false)} onListo={() => { setElegidas([]); recargar(); }} />
      )}
    </section>
  );
}

function Vacio() {
  const voi = useVoi()!;
  const ejemplos = ["Mostrame las ventas netas por día de este mes en un gráfico", "Armame un tablero con los indicadores de hoy"];
  return (
    <div className="rounded-2xl border border-dashed border-brand-border bg-white p-10 text-center">
      <LayoutDashboard size={32} className="mx-auto text-brand-mist" />
      <p className="mt-3 text-sm text-brand-graphite font-semibold">Todavía no hay nada en el lienzo</p>
      <p className="mt-1 text-sm text-brand-slate max-w-md mx-auto">
        Cuando Voi arma un gráfico, una tabla o un tablero, aparece acá, al lado del chat. Pedíselo con tus palabras:
      </p>
      <div className="mt-4 flex flex-col items-center gap-2">
        {ejemplos.map((e) => (
          <button key={e} type="button" onClick={() => { voi.enviar(e); }} className="inline-flex items-center gap-2 rounded-xl border border-brand-border px-3.5 py-2 text-sm text-brand-graphite hover:border-brand-primary/50">
            <Sparkles size={14} className="text-brand-primary" /> {e}
          </button>
        ))}
      </div>
    </div>
  );
}
