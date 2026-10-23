"use client";

/**
 * Creación rápida de postulantes (capacitador o mentor): con un toque se habilita un link de 20 minutos para el grupo,
 * con su QR. Los postulantes lo escanean, cargan sus datos y quedan en el grupo con su link personal. La hoja muestra
 * la cuenta regresiva y quiénes se van registrando (se actualiza sola), y se puede proyectar en pantalla completa.
 */
import { Maximize2, QrCode, RefreshCcw, ShieldOff, UserCheck, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { mmss, useCuentaRegresiva } from "@/components/admin/CreacionRapida";
import { Boton, Fallo, Hoja, cx, hace } from "@/components/portal/ui";
import { apiFetch } from "@/lib/api";
import { CAP_API, type RegistroRapido, type VistaRegistroRapido } from "./tipos";
import { CompartirLink } from "./ui";

const ESTADO: Record<Exclude<RegistroRapido["estado"], "vigente">, string> = {
  vencido: "venció", cerrado: "se cerró", agotado: "llegó al cupo",
};

function Registrados({ link }: { link: RegistroRapido }) {
  if (!link.registrados.length) {
    return <p className="text-[14px] text-brand-slate">Todavía nadie se registró con este link.</p>;
  }
  return (
    <ul className="card divide-y divide-brand-border overflow-hidden">
      {[...link.registrados].reverse().map((p) => (
        <li key={p.id} className="px-3 py-2.5 flex items-center gap-3 animate-fade">
          <span className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0"><UserCheck size={16} aria-hidden /></span>
          <span className="flex-1 min-w-0 text-[15px] font-semibold text-brand-ink truncate">{p.nombre} {p.apellido}</span>
          <span className="text-[12px] text-brand-slate shrink-0">{hace(p.at)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Para proyectar en la sala: el QR grande, el grupo, el tiempo que queda y cuántos se registraron. */
function PantallaCompleta({ link, grupo, quedan, onClose }: { link: RegistroRapido; grupo: string; quedan: number; onClose: () => void }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [onClose]);
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Código QR para registrarse" className="fixed inset-0 z-[80] bg-white flex flex-col items-center justify-center p-6 animate-fade">
      <button type="button" onClick={onClose} aria-label="Cerrar pantalla completa" className="absolute top-4 right-4 w-12 h-12 rounded-full flex items-center justify-center text-brand-slate hover:bg-brand-bg"><X size={26} aria-hidden /></button>
      <div className="text-[13px] uppercase tracking-wider2 font-semibold text-brand-slate">Escaneá para sumarte al grupo</div>
      <div className="font-display text-[34px] md:text-[52px] uppercase leading-tight text-brand-ink text-center">{grupo}</div>
      {link.qr_svg && <div className="mt-5 w-[min(72vw,62vh)] aspect-square bg-white p-3 rounded-2xl border border-brand-border [&_svg]:w-full [&_svg]:h-full"
        dangerouslySetInnerHTML={{ __html: link.qr_svg }} />}
      <div className="mt-5 flex items-center gap-6 text-center">
        <div><div className={cx("font-display text-[40px] leading-none tabular-nums", quedan <= 120 ? "text-brand-primary" : "text-brand-ink")}>{mmss(quedan)}</div>
          <div className="text-[12px] uppercase tracking-wider2 text-brand-slate mt-1">para registrarse</div></div>
        <div><div className="font-display text-[40px] leading-none tabular-nums text-emerald-700">{link.usos}</div>
          <div className="text-[12px] uppercase tracking-wider2 text-brand-slate mt-1">registrados</div></div>
      </div>
    </div>,
    document.body,
  );
}

export function HojaRegistroRapido({ grupoId, grupo, onClose, onCambio }: {
  grupoId: string; grupo: string; onClose: () => void; onCambio?: () => void;
}) {
  const [v, setV] = useState<VistaRegistroRapido | null>(null);
  const [desde, setDesde] = useState(0);
  const [ocupado, setOcupado] = useState<null | "habilitar" | "nuevo" | "cerrar">(null);
  const [error, setError] = useState<string | null>(null);
  const [grande, setGrande] = useState(false);
  const url = `${CAP_API}/grupos/${grupoId}/registro-rapido`;
  const usos = useRef<number | null>(null);
  const recibir = useCallback((x: VistaRegistroRapido) => {
    setV(x); setDesde(Date.now()); setError(null);
    // Si alguien se registró, el grupo de atrás se actualiza.
    const n = x.link?.usos ?? 0;
    if (usos.current !== null && n !== usos.current) onCambio?.();
    usos.current = n;
  }, [onCambio]);
  const cargar = useCallback(() => apiFetch<VistaRegistroRapido>(url).then(recibir).catch((e) => setError(e.message)), [url, recibir]);
  useEffect(() => { cargar(); }, [cargar]);
  const link = v?.link ?? null;
  const vigente = link?.estado === "vigente" && !!link.url;
  const quedan = useCuentaRegresiva(vigente ? link!.segundos : null, desde);
  // Mientras está vigente se consulta cada 4 segundos (nuevos registrados) y al llegar a 0 se vuelve a leer.
  useEffect(() => {
    if (!vigente) return;
    const t = setInterval(cargar, 4000);
    return () => clearInterval(t);
  }, [vigente, cargar]);
  useEffect(() => { if (vigente && quedan === 0) cargar(); }, [vigente, quedan, cargar]);

  const pedir = async (accion: "habilitar" | "nuevo" | "cerrar") => {
    setOcupado(accion); setError(null);
    try {
      recibir(await apiFetch<VistaRegistroRapido>(accion === "cerrar" ? `${url}/cerrar` : url, {
        method: "POST", body: accion === "cerrar" ? undefined : JSON.stringify({ origen: window.location.origin, nuevo: accion === "nuevo" }),
      }));
    } catch (e: any) { setError(e.message); } finally { setOcupado(null); }
  };
  const minutos = v?.minutos ?? 20;

  return (
    <Hoja titulo="Creación rápida" sobre={grupo} onClose={onClose} ocupada={!!ocupado}
      pie={vigente ? <>
        <Boton tipo="secundario" icono={ShieldOff} onClick={() => pedir("cerrar")} ocupado={ocupado === "cerrar"}>Cerrar link</Boton>
        <Boton tipo="fantasma" icono={RefreshCcw} onClick={() => pedir("nuevo")} ocupado={ocupado === "nuevo"}>Link nuevo · {minutos} min</Boton>
      </> : v?.puede ? <Boton icono={QrCode} onClick={() => pedir("habilitar")} ocupado={ocupado === "habilitar"}>Habilitar link · {minutos} min</Boton> : undefined}>
      {error && <Fallo onReintentar={v ? undefined : cargar}>{error}</Fallo>}
      {!v && !error && <div className="h-48 rounded-xl bg-brand-bg animate-pulse" />}
      {v && !vigente && (
        <div className="space-y-4">
          <div className="rounded-xl bg-brand-bg-soft border border-brand-border px-4 py-3.5 flex gap-3">
            <span className="w-10 h-10 rounded-xl bg-brand-ink text-white flex items-center justify-center shrink-0"><QrCode size={20} aria-hidden /></span>
            <p className="text-[14px] text-brand-ink leading-snug">
              Habilitá un link por <b>{minutos} minutos</b>. Los postulantes escanean el QR (o abren el link), cargan sus datos y
              quedan en el grupo con su link personal para el test y los entrenamientos. Vos ves quiénes se van sumando.
            </p>
          </div>
          {!v.puede && <p className="text-[14px] text-brand-slate">El grupo no está en curso: no recibe postulantes nuevos.</p>}
          {link && link.estado !== "vigente" && (
            <div>
              <div className="text-[11px] uppercase tracking-wider2 font-semibold text-brand-slate mb-2">
                El último link {ESTADO[link.estado as keyof typeof ESTADO] ?? "terminó"} · {link.usos === 1 ? "1 se registró" : `${link.usos} se registraron`}
              </div>
              {link.usos > 0 && <Registrados link={link} />}
            </div>
          )}
        </div>
      )}
      {v && vigente && link && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className={cx("inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[14px] font-semibold tabular-nums",
              quedan <= 120 ? "bg-brand-primary-light text-brand-primary-dark" : "bg-emerald-50 text-emerald-800")} aria-live="polite">
              <span className={cx("w-2 h-2 rounded-full", quedan <= 120 ? "bg-brand-primary" : "bg-emerald-500 animate-pulse")} aria-hidden />
              Vence en {mmss(quedan)}
            </span>
            <button type="button" onClick={() => setGrande(true)} className="inline-flex items-center gap-1.5 min-h-[40px] text-[14px] font-semibold text-brand-ink hover:text-brand-primary">
              <Maximize2 size={16} aria-hidden /> Pantalla completa
            </button>
          </div>
          <CompartirLink url={link.url!} qr={link.qr_svg} etiqueta="Link para registrarse"
            mensaje={`Sumate al grupo ${grupo} de Voicenter: registrate con este link (vale ${minutos} minutos):`} />
          <div>
            <div className="text-[11px] uppercase tracking-wider2 font-semibold text-brand-slate mb-2">
              Se registraron <b className="text-brand-ink tabular-nums">{link.usos}</b>{link.usos >= link.max_usos - 5 ? ` de ${link.max_usos}` : ""}
            </div>
            <Registrados link={link} />
          </div>
          <p className="text-[12px] text-brand-slate">Habilitado por {link.creado_por}. Mientras está vigente lo ve igual todo el equipo del grupo.</p>
          {grande && <PantallaCompleta link={link} grupo={grupo} quedan={quedan} onClose={() => setGrande(false)} />}
        </div>
      )}
    </Hoja>
  );
}
