"use client";

import { ArrowLeft, CircleDashed, PenLine, Search, TriangleAlert, UserPlus, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { diaCorto } from "@/components/portal/coaching";
import { PortalShell } from "@/components/portal/nav";
import { Boton, Cargando, Fallo, Fila, Hoja, Lista, PORTAL, Pasos, Seccion, cx, plural } from "@/components/portal/ui";
import {
  SUP_API, TIPO_COACHING, dm, num, type CoachingDetalle, type CoachingSinFirmar, type MetricaCoaching, type MiembroCoaching,
  type TipoCoaching, type VistaCoachingData,
} from "@/components/supervision/tipos";
import { apiFetch } from "@/lib/api";

const TIPOS: TipoCoaching[] = ["diario", "semanal", "mensual"];
const METRICAS = new Set(["pospago", "gpon", "uso", "conversacion", "otra"]);

export default function NuevoCoachingPage() {
  return <PortalShell><Nuevo /></PortalShell>;
}

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function Nuevo() {
  const router = useRouter();
  const [q] = useState(() => (typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search)));
  const operadorPedido = q.get("operador");
  const metrica = q.get("metrica") && METRICAS.has(q.get("metrica")!) ? (q.get("metrica") as MetricaCoaching) : null;
  const anterior = q.get("anterior");
  const [d, setD] = useState<VistaCoachingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoCoaching>("diario");
  const [buscar, setBuscar] = useState("");
  const [elegido, setElegido] = useState<MiembroCoaching | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    try { setD(await apiFetch<VistaCoachingData>(`${SUP_API}/portal/coaching`)); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const equipo = useMemo(() => (d?.equipo ?? []).filter((m) => m.actual), [d]);
  const pedido = operadorPedido ? equipo.find((m) => m.id === operadorPedido) : undefined;
  const sinFirmar = (opId: string): CoachingSinFirmar | undefined => d?.sin_firmar?.find((c) => c.operador_id === opId);
  const alertas = useMemo(() => new Set((d?.alertas ?? []).filter((a) => a.estado === "en_plazo" || a.estado === "vencida").map((a) => a.operador_id)), [d]);

  const crear = async (m: MiembroCoaching) => {
    setOcupado(true);
    setError(null);
    try {
      const c = await apiFetch<CoachingDetalle>(`${SUP_API}/portal/coaching`, {
        method: "POST",
        body: JSON.stringify({ operador_id: m.id, tipo, ...(metrica ? { metricas: [metrica] } : alertas.has(m.id) ? { metricas: ["uso"] } : {}),
          ...(anterior ? { anterior_id: anterior } : {}) }),
      });
      router.replace(`${PORTAL}/coaching/${c.id}`);
    } catch (e: any) { setError(e.message); setOcupado(false); setElegido(null); }
  };
  const tocar = (m: MiembroCoaching) => {
    if (sinFirmar(m.id)) setElegido(m);
    else crear(m);
  };

  const filtrados = useMemo(() => {
    const t = sinAcentos(buscar.trim());
    return t ? equipo.filter((m) => sinAcentos(m.nombre).includes(t)) : equipo;
  }, [equipo, buscar]);
  const prioridad = (m: MiembroCoaching) => alertas.has(m.id) || !m.coachings || (m.sin_firmar ?? 0) > 0;
  const primero = filtrados.filter(prioridad);
  const resto = filtrados.filter((m) => !prioridad(m));

  const fila = (m: MiembroCoaching) => {
    const sf = sinFirmar(m.id);
    const alerta = alertas.has(m.id);
    return (
      <Fila key={m.id} onClick={() => tocar(m)} disabled={ocupado}
        icono={sf ? PenLine : alerta ? TriangleAlert : !m.coachings ? CircleDashed : UserRound}
        tono={sf ? "naranja" : alerta ? "rojo" : !m.coachings ? "naranja" : "gris"} marcada={alerta || !!sf}
        titulo={m.nombre}
        sub={[
          sf && `Devolución sin firmar del ${dm(sf.fecha)}`,
          alerta && m.uso && `En alerta · ${num(m.uso.pct_sin_uso)}% sin uso`,
          !m.coachings ? "Sin coaching este mes" : `${plural(m.coachings, "coaching", "coachings")} · último el ${dm(m.ultimo_coaching)}`,
        ].filter(Boolean).join(" · ")} />
    );
  };

  return (
    <div className="max-w-xl mx-auto">
      <div className="flex items-start gap-1 mb-4">
        <Link href={PORTAL} aria-label="Volver a Hoy" className="w-11 h-11 -ml-2 rounded-full flex items-center justify-center text-brand-ink hover:bg-white shrink-0">
          <ArrowLeft size={22} aria-hidden />
        </Link>
        <div className="min-w-0 pt-0.5">
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">{anterior ? "Continúa un coaching sin mejora" : "Coaching nuevo"}</div>
          <h1 className="font-display text-[34px] uppercase text-brand-ink leading-tight">¿Con quién?</h1>
        </div>
      </div>
      <Pasos actual={1} nombres={["Asesor", "Lo que observaste", "Compromisos", "Devolución"]} />

      <div className="mt-5">
        <div className="label">Tipo de coaching</div>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tipo de coaching">
          {TIPOS.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={tipo === t} onClick={() => setTipo(t)}
              className={cx("min-h-[56px] rounded-lg border-2 px-2 text-sm font-semibold leading-tight",
                tipo === t ? "border-brand-ink bg-brand-ink text-white" : "border-brand-border bg-white text-brand-graphite")}>
              {TIPO_COACHING[t].label.split(" ")[0]}
              <span className={cx("block text-[11px] font-normal mt-0.5", tipo === t ? "text-white/70" : "text-brand-slate")}>{TIPO_COACHING[t].label.split(" ").slice(1).join(" ")}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-brand-slate mt-1.5">{TIPO_COACHING[tipo].ayuda}</p>
      </div>

      {error && <div className="mt-4"><Fallo onReintentar={!d ? cargar : undefined}>{error}</Fallo></div>}
      {!d ? (!error && <div className="mt-5"><Cargando filas={5} /></div>) : (
        <div className="mt-5 space-y-6">
          {pedido && (
            <div className="card p-4">
              <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">Coaching a</div>
              <div className="font-semibold text-lg text-brand-ink">{pedido.nombre}</div>
              <div className="mt-3"><Boton onClick={() => tocar(pedido)} ocupado={ocupado}>Empezar</Boton></div>
            </div>
          )}
          <label className="relative block">
            <Search size={20} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-mist" aria-hidden />
            <input type="search" className="input !min-h-[52px] !text-base !pl-11" placeholder="Buscar en tu equipo" value={buscar}
              onChange={(e) => setBuscar(e.target.value)} aria-label="Buscar asesor" />
          </label>
          {!equipo.length ? (
            <p className="card p-5 text-sm text-brand-slate">Todavía no tenés asesores asignados este mes.</p>
          ) : !filtrados.length ? (
            <p className="card p-5 text-sm text-brand-slate">Nadie de tu equipo se llama así.</p>
          ) : (
            <>
              {primero.length > 0 && <Seccion titulo="Primero estos" sub="En alerta, sin coaching este mes o con la devolución pendiente."><Lista>{primero.map(fila)}</Lista></Seccion>}
              {resto.length > 0 && <Seccion titulo={primero.length ? "Resto del equipo" : "Tu equipo"}><Lista>{resto.map(fila)}</Lista></Seccion>}
            </>
          )}
          <Boton tipo="secundario" icono={UserPlus} href={`${PORTAL}/equipo/nuevo${buscar.trim() ? `?nombre=${encodeURIComponent(buscar.trim())}` : ""}`}>
            ¿No está? Agregar asesor nuevo
          </Boton>
        </div>
      )}

      {elegido && (() => {
        const sf = sinFirmar(elegido.id)!;
        return (
          <Hoja sobre={elegido.nombre} titulo="Ya tiene una devolución pendiente" onClose={() => setElegido(null)} ocupada={ocupado}
            pie={<>
              <Boton tipo="secundario" onClick={() => crear(elegido)} ocupado={ocupado}>Abrir uno nuevo</Boton>
              <Boton href={`${PORTAL}/coaching/${sf.id}`}>Continuar ese</Boton>
            </>}>
            <p className="text-[15px] text-brand-graphite">
              El coaching del {dm(sf.fecha)} todavía no está firmado{sf.devolucion_vencida ? " y ya venció" : ` (vence ${diaCorto(sf.vence_devolucion)})`}.
              Lo mejor es terminarlo: sumale lo que viste hoy y hacé la devolución.
            </p>
          </Hoja>
        );
      })()}
    </div>
  );
}
