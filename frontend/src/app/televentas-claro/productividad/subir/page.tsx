"use client";

import { CheckCircle2, Clock, FileSpreadsheet, Loader2, RefreshCw, UploadCloud, X, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Procesando } from "@/components/Procesando";
import {
  PROD_API, PROD_HREF, fechaCorta, fechaLarga, n, type Corte, type InformeResumen, type RespuestaParametros,
} from "@/components/productividad/tipos";
import { ApiError, apiFetch } from "@/lib/api";

const ZONA = "America/Asuncion";

interface Item {
  id: string;
  file: File;
  /** Fecha y hora detectadas en el nombre (hora de Asunción). */
  detectada: { fecha: string; hora: string; ms: number } | null;
  manual: string; // 'YYYY-MM-DDTHH:MM' si el nombre no trae la marca de tiempo
  estado: "pendiente" | "subiendo" | "ok" | "error";
  error?: string;
  resultado?: { corte: Corte; reemplazo: boolean; informe: InformeResumen | null };
}

/** Misma regla que el backend: marca de tiempo Unix de 13 (ms) o 10 (s) dígitos en el nombre. */
function detectar(nombre: string): Item["detectada"] {
  const marcas = nombre.match(/(?<!\d)(\d{13}|\d{10})(?!\d)/g) ?? [];
  for (const m of marcas.reverse()) {
    const ms = m.length === 13 ? Number(m) : Number(m) * 1000;
    const d = new Date(ms);
    if (d.getUTCFullYear() < 2020 || d.getUTCFullYear() > 2100) continue;
    const partes = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(d).map((p) => [p.type, p.value]));
    return { fecha: `${partes.year}-${partes.month}-${partes.day}`, hora: `${partes.hour}:${partes.minute}`, ms };
  }
  return null;
}

export default function SubirCortesPage() {
  return (
    <AppShell>
      <Subir />
    </AppShell>
  );
}

type Resultado = NonNullable<Item["resultado"]>;

function Subir() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [arrastrando, setArrastrando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [proceso, setProceso] = useState<{ actual: number; total: number; fecha: string; hora: string } | null>(null);
  const [abriendo, setAbriendo] = useState<string | null>(null); // fecha del informe que se está abriendo
  const [regla, setRegla] = useState(30);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiFetch<RespuestaParametros>(`${PROD_API}/parametros`)
      .then((r) => setRegla(r.parametros.contacto_desde_seg))
      .catch(() => undefined); // sin permiso de ver: queda la regla por defecto
  }, []);

  const agregar = (files: FileList | File[]) => {
    const nuevos = Array.from(files)
      .filter((f) => f.name.toLowerCase().endsWith(".csv"))
      .map((file) => ({ id: `${file.name}-${file.size}-${file.lastModified}`, file, detectada: detectar(file.name), manual: "", estado: "pendiente" as const }));
    setItems((act) => {
      const ids = new Set(act.map((i) => i.id));
      return [...act, ...nuevos.filter((i) => !ids.has(i.id))]
        .sort((a, b) => (a.detectada?.ms ?? Infinity) - (b.detectada?.ms ?? Infinity));
    });
  };

  // Si se recarga o se cierra la página a mitad de la carga, los archivos que faltan no se suben: avisar.
  useEffect(() => {
    if (!subiendo) return;
    const aviso = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [subiendo]);

  const actualizar = (id: string, cambio: Partial<Item>) => setItems((act) => act.map((i) => (i.id === id ? { ...i, ...cambio } : i)));
  const pendientes = items.filter((i) => i.estado === "pendiente" || i.estado === "error");
  const faltaFecha = pendientes.some((i) => !i.detectada && !i.manual);

  const subir = async () => {
    const lote = pendientes;
    const resultados: Resultado[] = [];
    let errores = 0;
    setSubiendo(true);
    for (const [i, it] of lote.entries()) { // en orden cronológico: cada corte rehace el borrador de su día
      setProceso({
        actual: i + 1, total: lote.length,
        fecha: it.detectada?.fecha ?? it.manual.slice(0, 10), hora: it.detectada?.hora ?? it.manual.slice(11, 16),
      });
      actualizar(it.id, { estado: "subiendo", error: undefined });
      const form = new FormData();
      form.append("file", it.file);
      if (!it.detectada && it.manual) form.append("fecha_hora", it.manual);
      try {
        const r = await apiFetch<Resultado>(`${PROD_API}/cortes`, { method: "POST", body: form });
        actualizar(it.id, { estado: "ok", resultado: r });
        resultados.push(r);
      } catch (e: any) {
        errores += 1;
        actualizar(it.id, { estado: "error", error: e instanceof ApiError ? e.message : "No se pudo subir el archivo" });
      }
    }
    // Todo bien: abrir el informe del día más reciente. Con errores, quedarse para verlos y reintentar.
    const porDia = new Map<string, Resultado>();
    for (const r of resultados) if (r.informe) porDia.set(r.corte.fecha, r);
    const dias = [...porDia.keys()].sort();
    const ultimo = dias.length ? porDia.get(dias[dias.length - 1]) : undefined;
    if (!errores && ultimo?.informe) {
      setAbriendo(ultimo.corte.fecha);
      const q = new URLSearchParams({ procesados: String(resultados.length) });
      if (dias.length > 1) q.set("otros", dias.slice(0, -1).join(","));
      router.push(`${PROD_HREF}/informes/${ultimo.informe.id}?${q}`);
      return; // la pantalla de espera queda hasta que abre el informe
    }
    setProceso(null);
    setSubiendo(false);
  };

  // Días afectados (último resultado de cada día).
  const dias = new Map<string, NonNullable<Item["resultado"]>>();
  for (const it of items) if (it.resultado?.informe) dias.set(it.resultado.corte.fecha, it.resultado);

  return (
    <>
      <div className="mb-6">
        <Link href={PROD_HREF} className="text-xs text-brand-slate hover:text-brand-primary">← Informes diarios</Link>
        <h1 className="font-display text-3xl text-brand-ink uppercase mt-1">Subir cortes de llamadas</h1>
        <p className="text-sm text-brand-slate mt-1 max-w-3xl">
          El reporte <b>Tiempos Acumulados</b> de la plataforma en <code>.csv</code>. La <b>fecha de gestión y la hora del corte</b> salen del
          nombre del archivo (p. ej. <code className="text-xs">Tiempos_Acumulados_1791406800981.csv</code> = 07/10/2026 18:00). Podés subir varios a la vez.
        </p>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
        <div className="space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={(e) => { e.preventDefault(); setArrastrando(false); agregar(e.dataTransfer.files); }}
            onClick={() => input.current?.click()}
            className={`card p-10 border-2 border-dashed cursor-pointer text-center transition-colors ${arrastrando ? "border-brand-primary bg-brand-primary-light/40" : "border-brand-border hover:border-brand-primary/60"}`}
          >
            <UploadCloud size={36} className="mx-auto text-brand-primary" />
            <div className="font-display text-xl uppercase text-brand-ink mt-3">Arrastrá los archivos acá</div>
            <div className="text-sm text-brand-slate mt-1">o hacé clic para elegirlos · solo .csv · hasta 2 MB cada uno</div>
            <input ref={input} type="file" accept=".csv,text/csv" multiple className="hidden" onChange={(e) => { if (e.target.files) agregar(e.target.files); e.target.value = ""; }} />
          </div>

          {items.length > 0 && (
            <section className="card overflow-hidden">
              <div className="px-5 py-3 border-b border-brand-border bg-brand-bg-soft flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-brand-ink">{n(items.length)} archivo(s) · en orden de corte</div>
                {!subiendo && <button type="button" onClick={() => setItems([])} className="text-xs text-brand-slate hover:text-brand-primary">Vaciar</button>}
              </div>
              <ul className="divide-y divide-brand-border">
                {items.map((it) => (
                  <li key={it.id} className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <FileSpreadsheet size={20} className="text-brand-slate shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-brand-ink truncate">{it.file.name}</div>
                        {it.detectada ? (
                          <div className="text-xs text-brand-slate flex items-center gap-1.5 mt-0.5">
                            <Clock size={12} /> <span className="capitalize">{fechaLarga(it.detectada.fecha)}</span> · corte de las <b>{it.detectada.hora}</b>
                          </div>
                        ) : (
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <span className="text-xs text-brand-primary-dark font-semibold">El nombre no trae la fecha: indicala</span>
                            <input type="datetime-local" className="input py-1.5 w-auto text-xs" value={it.manual}
                              onChange={(e) => actualizar(it.id, { manual: e.target.value })} disabled={it.estado === "subiendo" || it.estado === "ok"} />
                          </div>
                        )}
                        {it.estado === "error" && <div className="text-xs text-brand-primary-dark mt-1">{it.error}</div>}
                        {it.estado === "ok" && it.resultado && (
                          <div className="text-xs text-emerald-700 mt-1">
                            {it.resultado.reemplazo ? "Reemplazó el corte de esa hora" : "Corte guardado"}
                            {it.resultado.informe && <> · borrador del día con {n(it.resultado.informe.cortes)} corte(s)</>}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 sm:justify-end shrink-0">
                      {it.estado === "pendiente" && <span className="text-xs text-brand-slate">{(it.file.size / 1024).toFixed(0)} KB</span>}
                      {it.estado === "subiendo" && <Loader2 size={18} className="animate-spin text-brand-cyan" />}
                      {it.estado === "ok" && <CheckCircle2 size={18} className="text-emerald-600" />}
                      {it.estado === "error" && <XCircle size={18} className="text-brand-primary" />}
                      {(it.estado === "pendiente" || it.estado === "error") && !subiendo && (
                        <button type="button" aria-label="Quitar" onClick={() => setItems((a) => a.filter((x) => x.id !== it.id))} className="text-brand-mist hover:text-brand-primary"><X size={16} /></button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="px-5 py-4 border-t border-brand-border flex items-center justify-between gap-3 flex-wrap">
                <span className="text-xs text-brand-slate">
                  {faltaFecha ? "Completá la fecha y hora de los archivos que no la traen en el nombre." : `${n(pendientes.length)} por subir.`}
                </span>
                <button type="button" onClick={subir} disabled={subiendo || !pendientes.length || faltaFecha} className="btn-primary">
                  {subiendo ? <><Loader2 size={16} className="animate-spin" /> Procesando…</> : pendientes.some((i) => i.estado === "error") ? <><RefreshCw size={16} /> Reintentar</> : <><UploadCloud size={16} /> Procesar {n(pendientes.length)} archivo(s)</>}
                </button>
              </div>
            </section>
          )}

          {!subiendo && dias.size > 0 && (
            <section className="card p-5">
              <h2 className="font-display text-lg uppercase text-brand-ink">Borradores actualizados</h2>
              <p className="text-xs text-brand-slate mt-0.5">Revisalos y publicalos: solo los días publicados entran en el acumulado semanal y mensual.</p>
              <ul className="mt-3 space-y-2">
                {[...dias.entries()].sort().map(([fecha, r]) => (
                  <li key={fecha} className="flex items-center justify-between gap-3 rounded-md border border-brand-border px-4 py-2.5">
                    <div>
                      <div className="text-sm font-semibold text-brand-ink capitalize">{fechaLarga(fecha)}</div>
                      <div className="text-xs text-brand-slate">{n(r.informe!.cortes)} corte(s) · hasta las {r.informe!.corte_final} · {n(r.informe!.llamadas)} llamadas · {n(r.informe!.agentes)} agentes</div>
                    </div>
                    <Link href={`${PROD_HREF}/informes/${r.informe!.id}`} className="btn-secondary text-xs px-3 py-2">Ver y publicar</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="card p-5 space-y-4 text-sm text-brand-graphite">
          <h2 className="font-display text-lg uppercase text-brand-ink">Cómo conviene cargar</h2>
          <div>
            <div className="font-semibold text-brand-ink">Un archivo al cierre</div>
            <p className="text-xs text-brand-slate mt-0.5">Alcanza para el informe del día y los acumulados semanal y mensual. Exportalo después de que termine el último turno: lo que pase después de la hora del export no entra.</p>
          </div>
          <div>
            <div className="font-semibold text-brand-ink">Un archivo por hora (recomendado)</div>
            <p className="text-xs text-brand-slate mt-0.5">Cada archivo es un corte acumulado. El sistema resta un corte del anterior y arma la curva por horario: llamadas, contacto y conversación de cada hora.</p>
          </div>
          <div>
            <div className="font-semibold text-brand-ink">Mínimo para ver los turnos</div>
            <p className="text-xs text-brand-slate mt-0.5">Un corte cerca del cambio de turno (13:00) y otro al cierre: así se separa el turno mañana del tarde.</p>
          </div>
          <div className="rounded-md bg-brand-orange/10 border border-brand-orange/30 p-3 text-xs">
            <b>Contacto desde {regla} s.</b> Pedí a la plataforma la columna «Short Talk &lt; {regla}s» (y, si se puede, «Short Talk &lt; 20s»): el sistema
            las reconoce solas. Si el archivo trae solo «Short Talk &lt; 10s», el contacto no se puede medir y el informe no lo muestra.
          </div>
          <p className="text-[11px] text-brand-mist">Subir otra vez un archivo de la misma hora reemplaza ese corte. Cada carga queda en auditoría.</p>
        </aside>
      </div>

      <Procesando
        abierto={!!proceso}
        titulo="Procesando cortes"
        listo={!!abriendo}
        avance={proceso && !abriendo ? { hecho: proceso.actual - 1, total: proceso.total } : null}
        detalle={abriendo
          ? <>Abriendo el informe del <span className="capitalize">{fechaCorta(abriendo)}</span>…</>
          : proceso && <>Corte {n(proceso.actual)} de {n(proceso.total)} · <span className="capitalize">{fechaCorta(proceso.fecha)}</span>{proceso.hora && <> · {proceso.hora}</>}</>}
      />
    </>
  );
}
