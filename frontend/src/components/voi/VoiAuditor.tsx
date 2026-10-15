"use client";

/**
 * Los modos de Voi con un informe destino: el modo auditor (investigación de auditoría) y el modo informe diario (armar
 * el informe del día con Voi). Mientras uno está activo, el panel, el lienzo y el botón de Voi llevan un borde fino
 * (globals.css: .voi-auditor pasa por los colores de Voicenter; .voi-informe late entre el púrpura y el cyan); todo lo
 * demás usa la paleta neutra de la plataforma.
 *
 * - SelectorAuditor: entrar en el modo auditor, elegir o cambiar el informe destino, salir.
 * - InvitacionInforme / ChipModoInforme: entrar en el modo informe diario (Voi arranca solo).
 * - FranjaAuditor: la franja que muestra el modo activo y su informe destino (panel y lienzo).
 * - TarjetaEvidencia: la tarjeta en la que el usuario elige qué piezas propuestas por Voi van al informe.
 * - HojaSumar: sumar al informe lo que el usuario eligió directo en el lienzo.
 */
import {
  ArrowUpRight, Check, CheckCircle2, ClipboardPenLine, ExternalLink, FileSearch, Layers, Loader2, LogOut, Maximize2, Search,
  ShieldCheck, Sparkles, X, XCircle,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AUD_API, ESTADO_AUD_LABEL, n, rangoPeriodos, type AuditoriaResumen, type EstadoAuditoria,
} from "@/components/auditoria/tipos";
import { ID_API, diaLargo, figurasHref, type InformeDetalle } from "@/components/informe-diario/tipos";
import { apiFetch } from "@/lib/api";
import {
  avisarHash, ddmm, esInformeDiario, etiquetaDestino, pantallaDestino, voiApi, type AccionVoi, type AjustesEvidencia,
  type DestinoEvidencia, type DetalleEvidencia, type DetalleModoAuditor, type InvestigacionVoi, type ResultadoEvidencia,
} from "@/lib/voi";
import { ICONO_TIPO, NOMBRE_TIPO } from "./lienzo/iconos";
import type { ArtefactoVoi, PiezaVoi } from "./lienzo/tipos";
import { useVoi } from "./VoiProvider";

/** La pestaña Evidencia del informe (donde quedan las figuras). */
export const informeHref = (id: string) => `/televentas-claro/auditoria/informes/${id}#evidencia`;
const EDITABLES: EstadoAuditoria[] = ["borrador", "en_revision"];
const ESTADO_CLS: Record<string, string> = { borrador: "badge-cyan", en_revision: "badge-primary" };

// ------------------------------------------------------------------ índice liviano del informe destino
export interface IndiceInforme {
  informe: { id: string; codigo: string; titulo: string; status: string; editable: boolean };
  hallazgos: { id: string; codigo: string; titulo: string; severidad: string; estado: string }[];
  figuras: { id: string; figura: number; titulo: string; tipo: string; origen: string; artefacto_id: string | null; hallazgo_id: string | null }[];
}

/** Hallazgos y figuras del informe destino (sin la evidencia congelada). Se recarga al cambiar de informe. */
export function useIndiceInforme(auditoriaId: string | null | undefined) {
  const [indice, setIndice] = useState<IndiceInforme | null>(null);
  const recargar = useCallback(async () => {
    if (!auditoriaId) { setIndice(null); return; }
    try { setIndice(await apiFetch<IndiceInforme>(`${AUD_API}/informes/${auditoriaId}/evidencias/indice`)); } catch { setIndice(null); }
  }, [auditoriaId]);
  useEffect(() => { recargar(); }, [recargar]);
  return { indice, recargar };
}

/** El índice del destino del modo activo: el informe de auditoría (hallazgos y figuras) o el informe diario (sus
 * figuras), con la misma forma, para marcar en el lienzo lo que ya está en el informe. */
export function useIndiceDestino(inv: InvestigacionVoi | null) {
  const [indice, setIndice] = useState<IndiceInforme | null>(null);
  const diario = esInformeDiario(inv);
  const id = diario ? inv?.informe_id ?? null : inv?.auditoria_id ?? null;
  const recargar = useCallback(async () => {
    if (!id) { setIndice(null); return; }
    try {
      if (diario) {
        const d = await apiFetch<InformeDetalle>(`${ID_API}/${id}`);
        setIndice({
          informe: { id: d.id, codigo: `Informe diario · ${ddmm(d.fecha)}`, titulo: `Informe diario del ${diaLargo(d.fecha)}`,
                     status: d.estado, editable: d.puede_editar },
          hallazgos: [],
          figuras: (d.figuras ?? []).map((f) => ({
            id: f.id, figura: f.figura, titulo: f.titulo ?? "", tipo: f.spec?.tipo ?? "", origen: f.origen ?? "",
            artefacto_id: f.artefacto_id ?? null, hallazgo_id: null,
          })),
        });
      } else {
        setIndice(await apiFetch<IndiceInforme>(`${AUD_API}/informes/${id}/evidencias/indice`));
      }
    } catch { setIndice(null); }
  }, [id, diario]);
  useEffect(() => { recargar(); }, [recargar]);
  return { indice, recargar };
}

/** La pieza del lienzo que corresponde a una clave («id» o «id#n» para una parte de un tablero). */
export function piezaDe(artefactos: ArtefactoVoi[], artefactoId: string, widget: number | null | undefined): PiezaVoi | null {
  const a = artefactos.find((x) => x.id === artefactoId);
  if (!a) return null;
  if (widget === null || widget === undefined) return a.spec;
  return a.spec.widgets?.[widget] ?? null;
}

const descripcionPieza = (tipo: string, widget: number | null) =>
  `${NOMBRE_TIPO[tipo] ?? "Pieza del lienzo"}${widget !== null ? ` · parte ${widget + 1} del tablero` : ""}`;

function BotonCerrar({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label="Cerrar"
      className="-mr-2 -mt-1 w-9 h-9 grid place-items-center rounded-lg text-brand-slate hover:bg-brand-bg hover:text-brand-ink disabled:opacity-50">
      <X size={18} />
    </button>
  );
}

/** Opción de una lista de radio (mismo dibujo que la elección de versión del informe). */
function Radio({ activo }: { activo: boolean }) {
  return (
    <span className={`mt-0.5 w-4 h-4 rounded-full border-2 grid place-items-center flex-shrink-0 ${activo ? "border-brand-primary" : "border-brand-mist"}`}>
      {activo && <span className="w-2 h-2 rounded-full bg-brand-primary" />}
    </span>
  );
}

// ------------------------------------------------------------------ franja
/** La franja del modo activo: el informe destino (abrirlo, y en modo auditor cambiarlo) y salir. */
export function FranjaAuditor({ inv, onCambiar, onSalir, onNavegar }: {
  inv: InvestigacionVoi;
  onCambiar: () => void;
  onSalir?: () => void;
  onNavegar?: () => void;
}) {
  const voi = useVoi()!;
  const diario = esInformeDiario(inv);
  const pantalla = pantallaDestino(inv);
  const etiqueta = etiquetaDestino(inv);
  const Icono = diario ? ClipboardPenLine : ShieldCheck;
  const modo = diario ? "modo informe diario" : "modo auditor";
  return (
    <div className="flex items-center gap-3 pl-4 pr-2 py-2 border-b border-brand-border bg-brand-bg-soft flex-shrink-0" role="status" aria-live="polite">
      <Icono size={16} className={`flex-shrink-0 ${diario ? "text-brand-purple" : "text-brand-cyan"}`} aria-hidden />
      <div className="min-w-0 flex-1 leading-snug">
        <div className="text-xs font-semibold text-brand-ink">{diario ? "Voi en modo informe diario" : "Voi en modo auditor"}</div>
        <div className="text-xs text-brand-slate truncate">
          {diario ? <>El agente arma con vos el informe del <span className="font-medium text-brand-graphite">{ddmm(inv.fecha)}</span> (borrador): sus gráficos van a ese informe</>
            : inv.auditoria_id ? <>El agente investiga con vos · <span className="font-medium text-brand-graphite">{inv.codigo}</span> · {inv.titulo}{inv.alcance ? <span className="block text-[11px] text-brand-slate truncate" title={inv.alcance}>Fuentes: {inv.alcance}</span> : null}</>
              : "El agente investiga con vos · sin informe destino"}
        </div>
      </div>
      {pantalla && (
        <button type="button" onClick={() => { onNavegar?.(); voi.navegarA(pantalla, `${etiqueta} · ${diario ? "Figuras" : "Evidencia"}`); }}
          title={diario ? "Abrir el informe diario (cierra el lienzo)" : "Ir a la evidencia del informe (cierra el lienzo)"}
          aria-label={diario ? "Abrir el informe diario" : "Ir a la evidencia del informe"}
          className="hidden sm:inline-flex w-8 h-8 items-center justify-center rounded-md text-brand-slate hover:bg-white hover:text-brand-ink">
          <ExternalLink size={14} />
        </button>
      )}
      {!diario && (
        <button type="button" onClick={onCambiar}
          className="rounded-md border border-brand-border bg-white px-2.5 py-1 text-xs font-semibold text-brand-graphite hover:border-brand-slate/60 hover:text-brand-ink whitespace-nowrap">
          {inv.auditoria_id ? "Cambiar" : "Elegir informe"}
        </button>
      )}
      {onSalir && (
        <button type="button" onClick={onSalir} title={`Salir del ${modo}`} aria-label={`Salir del ${modo}`}
          className="w-8 h-8 inline-flex items-center justify-center rounded-md text-brand-slate hover:bg-white hover:text-brand-primary">
          <LogOut size={15} />
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ invitación (bienvenida) y chip del compositor
export function InvitacionAuditor() {
  const voi = useVoi()!;
  return (
    <div className="mt-6 w-full rounded-xl border border-brand-border bg-white p-4 text-left">
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-lg bg-brand-bg text-brand-ink grid place-items-center flex-shrink-0"><FileSearch size={17} /></span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-brand-ink">Investigación de auditoría</div>
          <p className="mt-0.5 text-[13px] text-brand-slate leading-snug">
            Trabajá con un informe destino: cada gráfico que te muestre en el lienzo te lo ofrezco como figura y vos elegís cuáles van.
          </p>
        </div>
      </div>
      <button type="button" onClick={() => voi.setSelectorAuditor(true)} className="btn-secondary mt-3 w-full py-2">
        <ShieldCheck size={15} /> Entrar en modo auditor
      </button>
    </div>
  );
}

export function ChipModoAuditor() {
  const voi = useVoi()!;
  return (
    <button type="button" onClick={() => voi.setSelectorAuditor(true)} title="Investigación de auditoría con un informe destino"
      className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-dashed border-brand-border px-2.5 py-0.5 text-[11px] text-brand-slate hover:border-brand-slate/60 hover:text-brand-ink transition-colors">
      <ShieldCheck size={11} /> Modo auditor
    </button>
  );
}

/** Entrar en modo informe diario desde la bienvenida: Voi arranca solo con el informe de hoy. */
export function InvitacionInforme() {
  const voi = useVoi()!;
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const armar = async () => {
    setOcupado(true);
    setError(null);
    try { await voi.activarInformeDiario(undefined, { arrancar: true }); } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  return (
    <div className="mt-6 w-full rounded-xl border border-brand-border bg-white p-4 text-left">
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-lg bg-brand-purple/10 text-brand-purple grid place-items-center flex-shrink-0"><ClipboardPenLine size={17} /></span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-brand-ink">Informe diario con Voi</div>
          <p className="mt-0.5 text-[13px] text-brand-slate leading-snug">
            Miro los datos del día, te propongo resultados, resumen y métricas, y cada gráfico te lo ofrezco como figura del informe. Vos revisás y firmás.
          </p>
        </div>
      </div>
      <button type="button" onClick={armar} disabled={ocupado} className="btn-secondary mt-3 w-full py-2">
        {ocupado ? <Loader2 size={15} className="animate-spin" /> : <ClipboardPenLine size={15} />} Armar el informe de hoy con Voi
      </button>
      {error && <p className="mt-2 text-xs text-brand-primary">{error}</p>}
    </div>
  );
}

export function ChipModoInforme() {
  const voi = useVoi()!;
  const [ocupado, setOcupado] = useState(false);
  const armar = async () => {
    setOcupado(true);
    try { await voi.activarInformeDiario(undefined, { arrancar: true }); } catch { /* el panel lo cuenta */ } finally { setOcupado(false); }
  };
  return (
    <button type="button" onClick={armar} disabled={ocupado} title="Armar el informe diario de hoy con Voi"
      className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-dashed border-brand-border px-2.5 py-0.5 text-[11px] text-brand-slate hover:border-brand-slate/60 hover:text-brand-ink transition-colors disabled:opacity-60">
      {ocupado ? <Loader2 size={11} className="animate-spin" /> : <ClipboardPenLine size={11} />} Informe diario
    </button>
  );
}

export const SUGERENCIAS_INFORME = [
  "¿Cómo vino la productividad de llamadas hoy?",
  "Mostrame en un gráfico las ventas del día",
  "Prepará el borrador del informe con los datos de hoy",
];

export const SUGERENCIAS_AUDITOR = [
  "Hacé un barrido de alertas y decime qué no cierra",
  "¿Qué vendedores están críticos y por qué?",
  "Mostrame en un gráfico las líneas sin uso por vendedor del último corte",
];

/** Qué cambia en modo auditor (lo mismo en el selector y en la tarjeta en la que Voi lo sugiere). */
const QUE_CAMBIA: { Icono: any; texto: string }[] = [
  { Icono: Search, texto: "Voi busca alertas por su cuenta y señala lo que no cierra, con cifras y vendedores." },
  { Icono: Layers, texto: "Cada gráfico que te muestra te lo ofrece como figura del informe: vos elegís cuáles van." },
  { Icono: FileSearch, texto: "Todo se suma a un informe destino; las capturas y fotos las subís en su pestaña Evidencia." },
];

function QueCambia() {
  return (
    <ul className="space-y-1.5">
      {QUE_CAMBIA.map(({ Icono, texto }) => (
        <li key={texto} className="flex items-start gap-2 text-[13px] text-brand-graphite leading-snug">
          <Icono size={14} className="mt-0.5 flex-shrink-0 text-brand-cyan" /> <span>{texto}</span>
        </li>
      ))}
    </ul>
  );
}

/** La tarjeta en la que Voi sugiere activar el modo auditor porque la persona está investigando. */
export function TarjetaModoAuditor({ a, onConfirmar, onCancelar }: {
  a: AccionVoi;
  onConfirmar: (a: AccionVoi) => void;
  onCancelar: (a: AccionVoi) => void;
}) {
  const d = (a.detalle ?? {}) as DetalleModoAuditor;
  if (a.estado !== "pendiente") {
    const activo = a.estado === "ejecutada" || a.estado === "ejecutando";
    return (
      <div className="rounded-xl border border-brand-border bg-white px-3.5 py-2.5 flex items-start gap-2 text-sm animate-pop">
        {a.estado === "ejecutando" ? <Loader2 size={15} className="animate-spin text-brand-cyan" /> :
          <ShieldCheck size={15} className={activo ? "text-brand-cyan" : "text-brand-mist"} />}
        <span className="min-w-0 leading-snug">
          <span className={`block ${activo ? "font-semibold text-brand-ink" : "text-brand-slate"}`}>
            {activo ? "Voi entró en modo auditor" : "Seguimos sin el modo auditor"}
          </span>
          {activo && <span className="block text-xs text-brand-slate">Voi busca alertas por su cuenta y te ofrece cada gráfico como figura del informe.</span>}
        </span>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-brand-border bg-white p-3.5 shadow-soft animate-pop">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider2 text-brand-cyan">
        <ShieldCheck size={12} /> Sugerencia de Voi
      </div>
      <p className="mt-1.5 text-sm font-semibold text-brand-ink">¿Activamos el modo auditor?</p>
      {d.motivo && <p className="mt-0.5 text-xs text-brand-slate leading-snug">{d.motivo}</p>}
      <div className="mt-2.5"><QueCambia /></div>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={() => onConfirmar(a)} className="btn-primary px-4 py-1.5 text-xs whitespace-nowrap">
          <ShieldCheck size={14} /> Activar modo auditor
        </button>
        <button type="button" onClick={() => onCancelar(a)} className="btn-ghost px-3 py-1.5 text-xs whitespace-nowrap">Ahora no</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ selector del informe destino
/** Entrar en modo auditor, elegir o cambiar el informe destino, o salir. Modal en la compu, hoja en el teléfono. */
export function SelectorAuditor() {
  const voi = useVoi()!;
  const inv = voi.investigacion;
  const [informes, setInformes] = useState<AuditoriaResumen[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elegido, setElegido] = useState<string | null>(inv ? inv.auditoria_id ?? "" : null);
  const [filtro, setFiltro] = useState("");
  const [ocupado, setOcupado] = useState<"activar" | "salir" | "preparar" | null>(null);
  const cerrar = useCallback(() => { if (!ocupado) voi.setSelectorAuditor(false); }, [ocupado, voi]);

  useEffect(() => {
    apiFetch<{ items: AuditoriaResumen[] }>(`${AUD_API}/informes`)
      .then((r) => {
        const editables = r.items.filter((a) => EDITABLES.includes(a.status));
        setInformes(editables);
        // Sin destino elegido: se propone el informe más reciente en el que se puede trabajar.
        setElegido((e) => (e === null ? editables[0]?.id ?? "" : e));
      })
      .catch((e: any) => { setInformes([]); setError(e.message); });
  }, []);
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); cerrar(); } };
    window.addEventListener("keydown", f, true);
    return () => window.removeEventListener("keydown", f, true);
  }, [cerrar]);

  const lista = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    return (informes ?? []).filter((a) => !q || a.codigo.toLowerCase().includes(q) || a.titulo.toLowerCase().includes(q));
  }, [informes, filtro]);

  const correr = async (tipo: "activar" | "salir" | "preparar", fn: () => Promise<void>) => {
    setOcupado(tipo);
    setError(null);
    try { await fn(); voi.setSelectorAuditor(false); } catch (e: any) { setError(e.message); } finally { setOcupado(null); }
  };
  const activar = () => correr("activar", () => voi.activarAuditor(elegido || null));
  const salir = () => correr("salir", () => voi.desactivarAuditor());
  const preparar = () => correr("preparar", async () => {
    if (!inv) await voi.activarAuditor(null);
    voi.abrir();
    await voi.enviar("Prepará un informe de auditoría nuevo con el último corte publicado de ventas netas y dejalo como destino de esta investigación.");
  });
  const cambio = !inv || (elegido ?? "") !== (inv.auditoria_id ?? "");

  const opcion = (id: string, contenido: React.ReactNode, punteada = false) => {
    const sel = elegido === id;
    return (
      <button key={id || "sin-informe"} type="button" role="radio" aria-checked={sel} onClick={() => setElegido(id)}
        className={`w-full text-left rounded-lg border bg-white p-3 flex items-start gap-3 transition-colors ${
          sel ? "border-brand-primary ring-1 ring-brand-primary" : `${punteada ? "border-dashed" : ""} border-brand-border hover:border-brand-slate/50`}`}>
        <Radio activo={sel} />
        <span className="min-w-0 flex-1">{contenido}</span>
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4 no-print">
      <div className="absolute inset-0 bg-brand-ink/50 backdrop-blur-[2px] animate-fade" onClick={cerrar} />
      <div role="dialog" aria-modal="true" aria-labelledby="voi-sel-aud"
        className="relative w-full sm:max-w-lg max-h-[92vh] flex flex-col bg-white rounded-t-2xl sm:rounded-xl shadow-elevated overflow-hidden animate-pop">
        <div className="h-1.5 bg-brand-cyan flex-shrink-0" />
        <div className="px-6 pt-5 pb-4 border-b border-brand-border">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider2 text-brand-slate">Investigación de auditoría</div>
              <h2 id="voi-sel-aud" className="font-display text-2xl text-brand-ink uppercase leading-tight mt-0.5">Modo auditor</h2>
            </div>
            <BotonCerrar onClick={cerrar} disabled={!!ocupado} />
          </div>
          <div className="mt-3"><QueCambia /></div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-4">
          <div className="label">Informe destino</div>
          {informes && informes.length > 5 && (
            <label className="relative block mb-2">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-mist" />
              <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Buscar por código o título" className="input pl-8 py-2" />
            </label>
          )}
          {informes === null ? (
            <div className="py-6 text-sm text-brand-mist flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Buscando informes…</div>
          ) : (
            <div role="radiogroup" aria-label="Informe destino" className="space-y-2">
              {lista.map((a) => opcion(a.id, (
                <>
                  <span className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-brand-slate">{a.codigo}</span>
                    <span className={ESTADO_CLS[a.status] ?? "badge-neutral"}>{ESTADO_AUD_LABEL[a.status]}</span>
                  </span>
                  <span className="block text-sm font-semibold text-brand-ink truncate mt-1">{a.titulo}</span>
                  <span className="block text-xs text-brand-slate mt-0.5">
                    {rangoPeriodos(a)} · {n(a.hallazgos_abiertos)} hallazgo{a.hallazgos_abiertos === 1 ? "" : "s"} abierto{a.hallazgos_abiertos === 1 ? "" : "s"}
                  </span>
                </>
              )))}
              {informes.length === 0 && !error && (
                <p className="rounded-lg border border-dashed border-brand-border p-4 text-sm text-brand-slate">
                  No hay informes en borrador o en revisión. Podés empezar sin destino o pedirle a Voi que prepare uno.
                </p>
              )}
              {opcion("", (
                <>
                  <span className="block text-sm font-semibold text-brand-ink">Sin informe por ahora</span>
                  <span className="block text-xs text-brand-slate mt-0.5">Voi te pregunta a cuál va antes de sumar evidencia.</span>
                </>
              ), true)}
            </div>
          )}
          <button type="button" onClick={preparar} disabled={!!ocupado}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-primary hover:underline disabled:opacity-50">
            {ocupado === "preparar" ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Que Voi prepare un informe nuevo
          </button>
          {error && <p className="mt-3 text-sm text-brand-primary">{error}</p>}
        </div>

        <div className="border-t border-brand-border px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] flex items-center gap-2 flex-wrap">
          {inv && (
            <button type="button" onClick={salir} disabled={!!ocupado} className="btn-ghost px-2 py-2 text-brand-primary whitespace-nowrap">
              {ocupado === "salir" ? <Loader2 size={15} className="animate-spin" /> : <LogOut size={15} />} Salir del modo
            </button>
          )}
          <button type="button" onClick={cerrar} disabled={!!ocupado} className="btn-secondary ml-auto whitespace-nowrap">Cancelar</button>
          <button type="button" onClick={activar} disabled={!!ocupado || elegido === null || !cambio} className="btn-primary whitespace-nowrap">
            {ocupado === "activar" && <Loader2 size={15} className="animate-spin" />}
            {inv ? "Cambiar destino" : "Activar modo auditor"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ tarjeta: qué piezas propuestas van al informe
const ESTADO_TARJETA: Record<AccionVoi["estado"], { texto: string; clase: string; Icono: any }> = {
  pendiente: { texto: "Elegí qué va al informe", clase: "text-brand-orange", Icono: ShieldCheck },
  ejecutando: { texto: "Agregando al informe…", clase: "text-brand-cyan", Icono: Loader2 },
  ejecutada: { texto: "Agregado al informe", clase: "text-emerald-700", Icono: CheckCircle2 },
  cancelada: { texto: "No se sumó nada", clase: "text-brand-slate", Icono: XCircle },
  fallida: { texto: "No se pudo sumar", clase: "text-brand-primary", Icono: XCircle },
};

/** La tarjeta de `proponer_evidencia`: cada pieza con su casilla, título y lectura editables. Solo va lo elegido. */
export function TarjetaEvidencia({ a, artefactos, codigo, diario = false, onConfirmarCon, onCancelar, onAbrirLienzo, onNavegar }: {
  a: AccionVoi & { detalle: DetalleEvidencia };
  artefactos: ArtefactoVoi[];
  codigo?: string | null;
  /** El destino es el informe diario (cambia los textos). */
  diario?: boolean;
  onConfirmarCon: (a: AccionVoi, ajustes: AjustesEvidencia) => void;
  onCancelar: (a: AccionVoi) => void;
  onAbrirLienzo?: (id: string) => void;
  onNavegar?: () => void;
}) {
  const voi = useVoi()!;
  const piezas = a.detalle.piezas;
  const [sel, setSel] = useState<string[]>(() => piezas.map((p) => p.clave));
  const [ed, setEd] = useState<Record<string, { titulo: string; nota: string }>>(() =>
    Object.fromEntries(piezas.map((p) => {
      const spec = piezaDe(artefactos, p.artefacto_id, p.widget);
      return [p.clave, { titulo: p.titulo ?? spec?.titulo ?? "", nota: p.nota ?? "" }];
    })));
  const pendiente = a.estado === "pendiente";
  const estado = ESTADO_TARJETA[a.estado] ?? ESTADO_TARJETA.pendiente;
  const alternar = (c: string) => setSel((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));
  const confirmar = () => {
    const ediciones: AjustesEvidencia["ediciones"] = {};
    for (const p of piezas) {
      if (!sel.includes(p.clave)) continue;
      ediciones[p.clave] = { titulo: ed[p.clave].titulo.trim() || undefined, nota: ed[p.clave].nota };
    }
    onConfirmarCon(a, { seleccion: piezas.filter((p) => sel.includes(p.clave)).map((p) => p.clave), ediciones });
  };

  return (
    <div className="rounded-xl border border-brand-border bg-white p-3.5 shadow-soft animate-pop">
      <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider2 ${estado.clase}`}>
        <estado.Icono size={12} className={a.estado === "ejecutando" ? "animate-spin" : ""} />
        <span>{estado.texto}</span>
        {codigo && <span className="ml-auto text-[11px] font-semibold normal-case tracking-normal text-brand-slate whitespace-nowrap">{codigo}</span>}
      </div>
      <p className="mt-1.5 text-sm font-medium text-brand-ink leading-snug">
        {pendiente ? `Voi propone ${piezas.length === 1 ? "una figura" : `${piezas.length} figuras`} para el informe.` : a.mensaje ?? a.resumen}
      </p>
      {pendiente && (
        <p className="mt-0.5 text-xs text-brand-slate leading-snug">
          Marcá las que van y, si querés, ajustá el título y la lectura.
          {a.detalle.hallazgo && <> Respaldan el hallazgo <span className="font-semibold text-brand-ink">{a.detalle.hallazgo}</span>.</>}
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {piezas.map((p) => {
          const spec = piezaDe(artefactos, p.artefacto_id, p.widget);
          const tipo = spec?.tipo ?? "barras";
          const Icono = ICONO_TIPO[tipo] ?? Layers;
          if (!pendiente) {
            return (
              <li key={p.clave} className="flex items-center gap-2 text-sm text-brand-graphite">
                <Icono size={14} className="text-brand-slate flex-shrink-0" />
                <span className="min-w-0 flex-1 truncate">{p.titulo ?? spec?.titulo ?? "Pieza del lienzo"}</span>
                {a.estado === "ejecutada" && <Check size={14} className="text-emerald-600 flex-shrink-0" />}
              </li>
            );
          }
          const elegida = sel.includes(p.clave);
          const e = ed[p.clave];
          return (
            <li key={p.clave} className={`rounded-lg border px-3 py-2.5 transition-colors ${elegida ? "border-brand-slate/30 bg-brand-bg-soft" : "border-brand-border bg-white"}`}>
              <div className="flex items-start gap-2.5">
                <input type="checkbox" checked={elegida} onChange={() => alternar(p.clave)} aria-label={`Sumar «${e.titulo || "la pieza"}» al informe`}
                  className="mt-0.5 w-4 h-4 flex-shrink-0 accent-brand-primary cursor-pointer" />
                <div className={`min-w-0 flex-1 transition-opacity ${elegida ? "" : "opacity-55"}`}>
                  <div className="flex items-center gap-1.5 px-1.5 text-[11px] leading-4 text-brand-slate">
                    <Icono size={12} className="flex-shrink-0" /> <span className="truncate">{descripcionPieza(tipo, p.widget)}</span>
                  </div>
                  <input value={e.titulo} onChange={(ev) => setEd({ ...ed, [p.clave]: { ...e, titulo: ev.target.value } })} disabled={!elegida}
                    maxLength={255} aria-label="Título de la figura" placeholder="Título de la figura"
                    className="mt-1 w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm font-semibold text-brand-ink outline-none hover:border-brand-border focus:border-brand-cyan focus:bg-white" />
                  <textarea value={e.nota} onChange={(ev) => setEd({ ...ed, [p.clave]: { ...e, nota: ev.target.value } })} disabled={!elegida}
                    rows={e.nota ? 2 : 1} maxLength={4000} aria-label={diario ? "Lectura de la figura" : "Lectura del auditor"}
                    placeholder={diario ? "Lectura para quien recibe el informe (opcional)" : "Agregar la lectura del auditor (opcional)"}
                    className="w-full resize-none rounded-md border border-transparent bg-transparent px-1.5 py-1 text-xs leading-relaxed text-brand-graphite outline-none placeholder:text-brand-mist hover:border-brand-border focus:border-brand-cyan focus:bg-white" />
                </div>
                {onAbrirLienzo && artefactos.some((x) => x.id === p.artefacto_id) && (
                  <button type="button" onClick={() => onAbrirLienzo(p.artefacto_id)} title="Ver en el lienzo" aria-label="Ver en el lienzo"
                    className="w-7 h-7 grid place-items-center rounded-md text-brand-mist hover:text-brand-ink hover:bg-white flex-shrink-0">
                    <Maximize2 size={14} />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {pendiente && (
        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={confirmar} disabled={!sel.length} className="btn-primary px-4 py-1.5 text-xs whitespace-nowrap">
            <Check size={14} /> Agregar {sel.length > 1 ? `${sel.length} ` : ""}al {diario ? "informe diario" : "informe"}
          </button>
          <button type="button" onClick={() => onCancelar(a)} className="btn-ghost px-3 py-1.5 text-xs whitespace-nowrap">No sumar nada</button>
        </div>
      )}
      {a.pantalla && a.estado === "ejecutada" && (
        <button type="button" onClick={() => { onNavegar?.(); voi.navegarA(a.pantalla!, codigo ? `${codigo} · ${diario ? "Figuras" : "Evidencia"}` : "el informe"); }}
          className="mt-2.5 inline-flex items-center gap-1 text-xs font-semibold text-brand-primary hover:underline">
          Ir al informe <ArrowUpRight size={13} />
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ hoja: sumar desde el lienzo
export interface PiezaElegida {
  clave: string;
  artefacto: ArtefactoVoi;
  widget: number | null;
  spec: PiezaVoi;
}

/** Sumar al informe lo elegido en el lienzo: título y lectura de cada figura, y el hallazgo que respaldan. */
export function HojaSumar({ piezas, inv, indice, conversacionId, onCerrar, onListo }: {
  piezas: PiezaElegida[];
  inv: InvestigacionVoi;
  indice: IndiceInforme | null;
  conversacionId: string | null;
  onCerrar: () => void;
  onListo: (r: ResultadoEvidencia) => void;
}) {
  const voi = useVoi()!;
  const diario = esInformeDiario(inv);
  const etiqueta = etiquetaDestino(inv);
  const [ed, setEd] = useState<Record<string, { titulo: string; nota: string }>>(() =>
    Object.fromEntries(piezas.map((p) => [p.clave, { titulo: p.spec.titulo ?? "", nota: p.spec.nota ?? "" }])));
  const [cantidad] = useState(piezas.length);
  const [hallazgo, setHallazgo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoEvidencia | null>(null);

  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape" && !ocupado) { e.stopPropagation(); onCerrar(); } };
    window.addEventListener("keydown", f, true);
    return () => window.removeEventListener("keydown", f, true);
  }, [ocupado, onCerrar]);

  const sumar = async () => {
    const destino: DestinoEvidencia | null = diario
      ? (inv.informe_id ? { informe_diario_id: inv.informe_id } : null)
      : (inv.auditoria_id ? { auditoria_id: inv.auditoria_id } : null);
    if (!destino) return;
    setOcupado(true);
    setError(null);
    try {
      const r = await voiApi.sumarEvidencia(destino, conversacionId, piezas.map((p) => ({
        ...(p.artefacto.local ? { spec: p.spec } : { artefacto_id: p.artefacto.id, widget: p.widget ?? undefined }),
        titulo: ed[p.clave].titulo.trim() || undefined,
        nota: ed[p.clave].nota.trim() || undefined,
        hallazgo_id: !diario && hallazgo ? hallazgo : undefined,
      })));
      setResultado(r);
      onListo(r);
      // La pantalla del informe diario (si está abierta) se actualiza sola.
      if (diario) window.dispatchEvent(new CustomEvent("voi:figuras"));
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4 no-print">
      <div className="absolute inset-0 bg-brand-ink/50 backdrop-blur-[2px] animate-fade" onClick={() => !ocupado && onCerrar()} />
      <div role="dialog" aria-modal="true" aria-labelledby="voi-hoja-sumar"
        className="relative w-full sm:max-w-xl max-h-[92vh] flex flex-col bg-white rounded-t-2xl sm:rounded-xl shadow-elevated overflow-hidden animate-pop">
        <div className={`h-1.5 flex-shrink-0 ${resultado ? "bg-emerald-500" : "bg-brand-cyan"}`} />
        <div className="px-6 pt-5 pb-4 border-b border-brand-border flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider2 text-brand-slate">{diario ? "Voi en modo informe diario" : "Voi en modo auditor"} · {etiqueta}</div>
            <h2 id="voi-hoja-sumar" className="font-display text-2xl text-brand-ink uppercase leading-tight mt-0.5">
              {resultado ? (diario ? "Figuras sumadas" : "Evidencia sumada") : `Sumar ${cantidad === 1 ? "una figura" : `${cantidad} figuras`} al informe`}
            </h2>
            <div className="text-sm text-brand-slate truncate">{diario ? `Informe diario del ${diaLargo(inv.fecha)}` : inv.titulo}</div>
          </div>
          <BotonCerrar onClick={onCerrar} disabled={ocupado} />
        </div>

        {resultado ? (
          <div className="px-6 py-5 space-y-3 overflow-y-auto">
            {resultado.agregadas.length > 0 && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                  <CheckCircle2 size={16} />
                  {resultado.agregadas.length === 1 ? "Una figura nueva" : `${resultado.agregadas.length} figuras nuevas`} en {resultado.informe.codigo}
                </div>
                <ul className="mt-2 space-y-1 text-sm text-brand-graphite">
                  {resultado.agregadas.map((f) => <li key={f.id}><span className="font-semibold text-brand-ink">Figura {f.figura}</span> · {f.titulo}</li>)}
                </ul>
              </div>
            )}
            {resultado.repetidas.length > 0 && (
              <div className="rounded-lg border border-brand-border bg-brand-bg-soft p-4 text-sm text-brand-slate">
                Ya estaban en el informe (no se duplicaron): {resultado.repetidas.map((f) => `Figura ${f.figura}`).join(", ")}.
              </div>
            )}
            <p className="text-xs text-brand-slate leading-snug">
              «Ir al informe» cierra el lienzo y abre {diario ? "la sección Figuras del informe diario" : `la pestaña Evidencia de ${resultado.informe.codigo}`};
              después lo volvés a abrir desde el panel de Voi.
            </p>
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <button type="button" className="btn-primary"
                onClick={() => {
                  onCerrar();
                  voi.navegarA(resultado.informe.pantalla ?? (diario ? figurasHref(resultado.informe.id) : informeHref(resultado.informe.id)),
                    `${resultado.informe.codigo} · ${diario ? "Figuras" : "Evidencia"}`);
                }}>
                Ir al informe <ArrowUpRight size={15} />
              </button>
              <button type="button" onClick={onCerrar} className="btn-secondary">{diario ? "Seguir armando" : "Seguir investigando"}</button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-4 space-y-3">
              {piezas.map((p, i) => {
                const Icono = ICONO_TIPO[p.spec.tipo] ?? Layers;
                const e = ed[p.clave];
                return (
                  <div key={p.clave} className="rounded-lg border border-brand-border p-3">
                    <div className="flex items-center gap-1.5 text-xs text-brand-slate">
                      <Icono size={13} className="flex-shrink-0" /> Pieza {i + 1} · {descripcionPieza(p.spec.tipo, p.widget)}
                    </div>
                    <input value={e.titulo} maxLength={255} onChange={(ev) => setEd({ ...ed, [p.clave]: { ...e, titulo: ev.target.value } })}
                      aria-label="Título de la figura" placeholder="Título: la conclusión que muestra" className="input mt-2 py-2 font-semibold" />
                    <textarea value={e.nota} maxLength={4000} rows={2} onChange={(ev) => setEd({ ...ed, [p.clave]: { ...e, nota: ev.target.value } })}
                      aria-label={diario ? "Lectura de la figura" : "Lectura del auditor"}
                      placeholder={diario ? "Lectura para quien recibe el informe: qué muestra y por qué importa (opcional)"
                        : "Lectura del auditor: qué muestra, por qué importa, fuente y corte (opcional)"}
                      className="input mt-2 min-h-[64px]" />
                  </div>
                );
              })}
              {!diario && indice && indice.hallazgos.length > 0 && (
                <div>
                  <label className="label" htmlFor="voi-hoja-hallazgo">Respaldan el hallazgo (opcional)</label>
                  <select id="voi-hoja-hallazgo" value={hallazgo} onChange={(e) => setHallazgo(e.target.value)} className="input">
                    <option value="">Ninguno en particular</option>
                    {indice.hallazgos.filter((h) => h.estado !== "descartado").map((h) => (
                      <option key={h.id} value={h.id}>{h.codigo} · {h.titulo.slice(0, 80)}</option>
                    ))}
                  </select>
                </div>
              )}
              <p className="text-xs text-brand-slate">
                {piezas.some((p) => p.artefacto.local) ? "Las tablas del chat se congelan tal como se ven: el informe no cambia si los datos cambian después. " : ""}
                {diario ? "Quedan en el informe y en su PDF; las revisás antes de firmar." : "Queda registrado en la bitácora del informe."}
              </p>
              {error && <p className="text-sm text-brand-primary">{error}</p>}
            </div>
            <div className="border-t border-brand-border px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] flex items-center justify-end gap-2">
              <button type="button" onClick={onCerrar} disabled={ocupado} className="btn-secondary whitespace-nowrap">Cancelar</button>
              <button type="button" onClick={sumar} disabled={ocupado || !piezas.length} className="btn-primary whitespace-nowrap">
                {ocupado && <Loader2 size={15} className="animate-spin" />} {diario ? "Agregar al informe diario" : "Agregar al informe"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
