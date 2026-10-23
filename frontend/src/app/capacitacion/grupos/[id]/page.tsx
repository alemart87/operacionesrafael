"use client";

import { ArrowLeft, Bot, ChevronRight, Flag, Link2, Pencil, QrCode, Radio, Search, Send, UserPlus } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Pestanas } from "@/components/capacitacion/pestanas";
import {
  CAP_API, CAP_HREF, COLOR_TRAMO, ESTADOS, ESTADOS_GRUPO, NIVEL_IPV, decimal, diasTexto, fecha, pct,
  type EntrenamientoFila, type EstadoGrupo, type GrupoDetalle, type Postulante, type ResumenIpv,
} from "@/components/capacitacion/tipos";
import { Barra, Dato, EmbudoVista, EstadoTag, GrupoTag, HojaEnlace, HojaEstado, HojaGrupo, HojaPostulante, TablaDemo } from "@/components/capacitacion/ui";
import { Boton, Cargando, Chips, Encabezado, Etiqueta, Fallo, Hoja, Seccion, cx, hace, useAviso } from "@/components/portal/ui";
import { HojaEnviar, HojaEnviarA, MediaEntrenamientos, MetaEntrenamientos } from "@/components/capacitacion/entrenamientos";
import { HojaRegistroRapido } from "@/components/capacitacion/registro-rapido";
import { apiFetch } from "@/lib/api";

export default function GrupoPage() {
  return (
    <AppShell>
      <Grupo />
    </AppShell>
  );
}

type Filtro = "todos" | "sala" | "piso" | "altas" | "salidas";
const FILTRO: Record<Filtro, (p: Postulante) => boolean> = {
  todos: () => true, sala: (p) => p.estado === "en_capacitacion", piso: (p) => p.en_piso,
  altas: (p) => p.estado === "alta_operativa", salidas: (p) => p.estado === "abandono" || p.estado === "baja",
};
const SEXO_CORTO = { F: "F", M: "M", X: "Otro" };

function Grupo() {
  const { id } = useParams<{ id: string }>();
  const [g, setG] = useState<GrupoDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [buscar, setBuscar] = useState("");
  const [hoja, setHoja] = useState<null | { t: "nuevo" } | { t: "editar" } | { t: "estado_grupo" } | { t: "estado"; p: Postulante } | { t: "link"; p: Postulante }
    | { t: "enviar"; p: Postulante } | { t: "entrenamiento"; p: Postulante } | { t: "entrenar_grupo" } | { t: "registro_rapido" }>(null);
  const [aviso, avisar] = useAviso();
  const cargar = useCallback(() => {
    apiFetch<GrupoDetalle>(`${CAP_API}/grupos/${id}`).then((x) => { setG(x); setError(null); }).catch((e) => setError(e.message));
  }, [id]);
  useEffect(cargar, [cargar]);
  // «Mi grupo» del mentor llega con los que están en piso.
  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get("f");
    if (f && f in FILTRO) setFiltro(f as Filtro);
  }, []);

  const lista = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return (g?.postulantes ?? []).filter(FILTRO[filtro]).filter((p) => !q || `${p.nombre} ${p.apellido} ${p.ci}`.toLowerCase().includes(q));
  }, [g, filtro, buscar]);

  if (error) return <Fallo onReintentar={cargar}>{error}</Fallo>;
  if (!g) return <Cargando filas={5} />;
  const cuenta = (f: Filtro) => g.postulantes.filter(FILTRO[f]).length;
  const capacitador = g.roles.includes("capacitador") || g.roles.includes("gestion");

  return (
    <div className="max-w-screen-xl mx-auto">
      {aviso}
      <Link href={CAP_HREF} className="inline-flex items-center gap-1 text-sm text-brand-slate hover:text-brand-ink mb-2"><ArrowLeft size={16} aria-hidden /> Grupos</Link>
      <Encabezado sobre={<span className="inline-flex items-center gap-2">{g.operacion ?? "Capacitación ÁGIL"} <GrupoTag estado={g.estado} /></span>} titulo={g.nombre}>
        {g.estado === "en_curso" ? `Día ${g.duracion_dias}` : diasTexto(g.duracion_dias)} · desde el {fecha(g.fecha_inicio)}
        {g.fin_previsto && g.estado === "en_curso" && ` · fin previsto ${fecha(g.fin_previsto)}`}
        {g.fecha_fin && ` · cerró el ${fecha(g.fecha_fin)}`}
        <br />Capacitador: <b className="text-brand-ink">{g.capacitador.nombre}</b> · Mentor{g.mentores.length > 1 ? "es" : ""}: <b className="text-brand-ink">{g.mentores.map((m) => m.nombre).join(", ") || "sin asignar"}</b>
        {g.estado === "cancelada" && g.motivo && <><br />Cancelado: {g.motivo}</>}
      </Encabezado>
      <Pestanas />

      {/* Las acciones del día, simples y a la vista (también en el celular) */}
      {g.estado !== "cancelada" && (
        <div className="grid grid-cols-2 md:flex gap-2 mb-2">
          {g.puede.postulantes && <Boton icono={UserPlus} onClick={() => setHoja({ t: "nuevo" })} className="!min-h-[52px] !px-3 !text-[15px] md:!w-auto">Postulante</Boton>}
          {/* Creación rápida: un QR o link de 20 minutos para que se registren solos (también el mentor). */}
          {g.puede.registro_rapido && <Boton tipo={g.puede.postulantes ? "secundario" : "primario"} icono={QrCode} onClick={() => setHoja({ t: "registro_rapido" })}
            className="!min-h-[52px] !px-3 !text-[15px] md:!w-auto">Creación rápida</Boton>}
          <Boton tipo={g.puede.postulantes || g.puede.registro_rapido ? "secundario" : "primario"} icono={Bot} onClick={() => setHoja({ t: "entrenar_grupo" })}
            className={cx("!min-h-[52px] !px-3 !text-[15px] md:!w-auto", (Number(g.puede.postulantes) + Number(!!g.puede.registro_rapido)) % 2 === 0 && "col-span-2")}>Entrenamiento</Boton>
        </div>
      )}
      {(g.puede.estados.length > 0 || g.puede.editar || g.estado === "en_curso") && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-5">
          {g.estado === "en_curso" && <Link href={`${CAP_HREF}/vivo?grupo=${g.id}`} className="inline-flex items-center gap-1.5 min-h-[40px] text-sm font-semibold text-brand-slate hover:text-brand-ink"><Radio size={15} aria-hidden /> En vivo</Link>}
          {g.puede.estados.length > 0 && <button type="button" onClick={() => setHoja({ t: "estado_grupo" })} className="inline-flex items-center gap-1.5 min-h-[40px] text-sm font-semibold text-brand-slate hover:text-brand-ink"><Flag size={15} aria-hidden /> Estado del grupo</button>}
          {g.puede.editar && <button type="button" onClick={() => setHoja({ t: "editar" })} className="inline-flex items-center gap-1.5 min-h-[40px] text-sm font-semibold text-brand-slate hover:text-brand-ink"><Pencil size={15} aria-hidden /> Editar grupo</button>}
        </div>
      )}

      {/* En el celular, los números en una sola franja para que la lista quede a mano. */}
      <div className="md:hidden card mb-4 grid grid-cols-4 divide-x divide-brand-border text-center">
        {[
          { v: g.embudo.total, l: "personas" },
          { v: pct(g.efectividad), l: "efectividad", verde: true },
          { v: g.avance === null ? "—" : `${g.avance}%`, l: "entrenam." },
          { v: `${g.ipv_detalle.realizados}/${g.ipv_detalle.total}`, l: "IPV" },
        ].map((x) => (
          <div key={x.l} className="py-2.5 px-1 min-w-0">
            <div className={cx("font-display text-xl leading-none tabular-nums", x.verde ? "text-emerald-700" : "text-brand-ink")}>{x.v}</div>
            <div className="text-[10px] uppercase tracking-wider2 text-brand-slate mt-1 truncate">{x.l}</div>
          </div>
        ))}
      </div>
      <div className="hidden md:grid md:grid-cols-3 xl:grid-cols-6 gap-2.5 mb-6">
        <Dato label="Postulantes" valor={g.embudo.total} sub={`${g.embudo.activos} activos · ${g.embudo.en_piso} en piso`} />
        <Dato label="Efectividad" valor={pct(g.efectividad)} sub={`${g.embudo.altas} altas operativas`} tono="verde" />
        <Dato label="Entrenamientos" valor={g.avance === null ? "—" : `${g.avance}%`} sub={`avance · ${g.meta.cumplen} de ${g.meta.activos} llegaron al mínimo de ${g.meta.entrenamientos}`} />
        <Dato label="Nivel comercial" valor={g.resultado ? <span style={{ color: COLOR_TRAMO[g.resultado.tramo] }}>{decimal(g.resultado.nivel)}</span> : "—"}
          sub={g.resultado ? `media de ${g.resultado.casos} casos · info ${g.resultado.info_pct}%` : "Sin casos evaluados"} />
        <Dato label="Hicieron el IPV" valor={`${g.ipv_detalle.realizados}/${g.ipv_detalle.total}`} sub={`${pct(g.ipv_detalle.porcentaje)}${g.ipv_detalle.en_curso ? ` · ${g.ipv_detalle.en_curso} haciéndolo` : ""}`} />
        <Dato label="Feedback" valor={g.feedback_detalle.total} sub={g.feedback_detalle.sin_feedback ? `${g.feedback_detalle.sin_feedback} sin feedback del equipo` : "Todos con feedback"} tono={g.feedback_detalle.sin_feedback ? "rojo" : undefined} />
      </div>

      <Seccion titulo="Postulantes" sub="Tocá un postulante para ver su ficha.">
        <div className="space-y-2.5 mb-3">
          <Chips etiqueta="Filtrar" valor={[filtro]} onChange={(v) => v[0] && setFiltro(v[0])} opciones={[
            { v: "todos", label: `Todos ${cuenta("todos")}` }, { v: "sala", label: `En sala ${cuenta("sala")}` },
            { v: "piso", label: `En piso ${cuenta("piso")}` }, { v: "altas", label: `Altas ${cuenta("altas")}` },
            { v: "salidas", label: `Salidas ${cuenta("salidas")}` }]} />
          {g.postulantes.length > 8 && (
            <label className="relative block max-w-sm">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-mist" aria-hidden />
              <input className="input pl-9" placeholder="Buscar por nombre o CI" value={buscar} onChange={(e) => setBuscar(e.target.value)} aria-label="Buscar" />
            </label>
          )}
        </div>
        {g.postulantes.length === 0 ? (
          <div className="card p-10 text-center text-sm text-brand-slate">
            {g.puede.postulantes || g.puede.registro_rapido ? <>Cargalos con «Postulante» o usá <b className="text-brand-ink">Creación rápida</b>: un QR para que se registren solos.</> : "Todavía no hay postulantes."}
          </div>
        ) : lista.length === 0 ? (
          <div className="card p-6 text-center text-sm text-brand-slate">Nadie con este filtro.</div>
        ) : (
          <>
            <ul className="md:hidden card divide-y divide-brand-border overflow-hidden">
              {lista.map((p) => <TarjetaPostulante key={p.id} p={p} link={g.estado !== "cancelada"} onEstado={() => setHoja({ t: "estado", p })} onLink={() => setHoja({ t: "enviar", p })} />)}
            </ul>
            <TablaPostulantes lista={lista} link={g.estado !== "cancelada"} onEstado={(p) => setHoja({ t: "estado", p })} onLink={(p) => setHoja({ t: "enviar", p })} />
          </>
        )}
      </Seccion>

      <div className="grid lg:grid-cols-2 gap-6 mt-8">
        <Seccion titulo="Embudo" sub="De los que ingresaron, hasta dónde llegaron."><EmbudoVista e={g.embudo} /></Seccion>
        <Seccion titulo="IPV del grupo" sub="Promedio de decatipos de quienes lo hicieron."><IpvGrupo r={g.ipv_detalle} /></Seccion>
        <Seccion titulo="Por sexo"><TablaDemo titulo="Sexo" filas={g.estadisticas.sexo} /></Seccion>
        <Seccion titulo="Por edad" sub={g.estadisticas.edad_promedio ? `Edad promedio: ${g.estadisticas.edad_promedio} años` : undefined}><TablaDemo titulo="Franja de edad" filas={g.estadisticas.edad} /></Seccion>
      </div>

      {g.historial.length > 0 && (
        <Seccion titulo="Historial del grupo" className="mt-8">
          <ol className="card divide-y divide-brand-border">
            {g.historial.map((h, i) => (
              <li key={i} className="px-4 py-2.5 text-sm flex justify-between gap-3">
                <span className="text-brand-ink">{h.tipo === "grupo_creado" ? "Grupo creado" : h.tipo === "grupo_estado" ? `Pasó a ${ESTADOS_GRUPO[h.a as EstadoGrupo]?.nombre ?? h.a}` : h.tipo === "postulante_borrado" ? "Se borró un postulante cargado por error" : "Datos del grupo editados"}
                  {h.motivo && <span className="text-brand-slate"> · {h.motivo}</span>}</span>
                <span className="text-brand-slate text-xs shrink-0">{h.por ?? ""} · {hace(h.at)}</span>
              </li>
            ))}
          </ol>
        </Seccion>
      )}

      {hoja?.t === "registro_rapido" && <HojaRegistroRapido grupoId={g.id} grupo={g.nombre} onClose={() => { setHoja(null); cargar(); }} onCambio={cargar} />}
      {hoja?.t === "nuevo" && <HojaPostulante grupoId={g.id} onClose={() => { setHoja(null); cargar(); }}
        onListo={(p, otro) => { avisar(`${p.nombre} ${p.apellido} agregado`); if (!otro) setHoja(null); cargar(); }} />}
      {hoja?.t === "editar" && <HojaGrupo grupo={g} gestion={g.roles.includes("gestion")} onClose={() => setHoja(null)} onListo={() => { setHoja(null); cargar(); avisar("Grupo actualizado"); }} />}
      {hoja?.t === "estado_grupo" && <HojaEstadoGrupo g={g} onClose={() => setHoja(null)} onListo={(x) => { setG(x); setHoja(null); avisar(`El grupo quedó ${ESTADOS_GRUPO[x.estado].nombre.toLowerCase()}`); }} />}
      {hoja?.t === "estado" && <HojaEstado p={hoja.p} onClose={() => setHoja(null)} onListo={(p) => { setHoja(null); cargar(); avisar(`${p.nombre}: ${ESTADOS[p.estado].nombre}`); }} />}
      {hoja?.t === "link" && <HojaEnlace p={hoja.p} gestiona={capacitador} onClose={() => setHoja(null)} onCambio={cargar} />}
      {hoja?.t === "enviar" && (
        <Hoja titulo="Enviar" sobre={`${hoja.p.nombre} ${hoja.p.apellido}`} onClose={() => setHoja(null)}>
          <div className="space-y-2.5">
            <button type="button" onClick={() => setHoja({ t: "entrenamiento", p: hoja.p })} className="w-full text-left card px-4 py-3 flex items-center gap-3 min-h-[72px] hover:border-brand-ink">
              <span className="w-11 h-11 rounded-xl bg-brand-ink text-white flex items-center justify-center shrink-0"><Bot size={22} aria-hidden /></span>
              <span className="min-w-0 flex-1"><span className="block font-semibold text-[15px] text-brand-ink">Un entrenamiento</span>
                <span className="block text-[13px] text-brand-slate">Lleva {hoja.p.avance.terminados} hechos (mínimo {hoja.p.avance.meta}, puede hacer más)</span></span>
              <ChevronRight size={18} className="text-brand-mist" aria-hidden />
            </button>
            <button type="button" onClick={() => setHoja({ t: "link", p: hoja.p })} className="w-full text-left card px-4 py-3 flex items-center gap-3 min-h-[72px] hover:border-brand-ink">
              <span className="w-11 h-11 rounded-xl bg-brand-primary text-white flex items-center justify-center shrink-0"><Link2 size={22} aria-hidden /></span>
              <span className="min-w-0 flex-1"><span className="block font-semibold text-[15px] text-brand-ink">Su link</span>
                <span className="block text-[13px] text-brand-slate">El mismo para el test IPV y los entrenamientos: QR, copiar o WhatsApp</span></span>
              <ChevronRight size={18} className="text-brand-mist" aria-hidden />
            </button>
          </div>
        </Hoja>
      )}
      {hoja?.t === "entrenamiento" && <HojaEnviarA pid={hoja.p.id} nombre={`${hoja.p.nombre} ${hoja.p.apellido}`} onClose={() => { setHoja(null); cargar(); }} />}
      {hoja?.t === "entrenar_grupo" && <EnviarAlGrupo grupoId={g.id} onClose={() => { setHoja(null); cargar(); }} />}
    </div>
  );
}

function IpvChip({ p }: { p: Postulante }) {
  const i = p.ipv;
  if (i.estado === "terminado" && i.dgv) return <span className="text-[12px] tabular-nums"><b style={{ color: NIVEL_IPV[i.dgv.nivel].color }}>DGV {i.dgv.decatipo}</b> <span className="text-brand-slate">{NIVEL_IPV[i.dgv.nivel].nombre}</span></span>;
  if (i.estado === "en_curso") return <span className="text-[12px] text-brand-slate tabular-nums">IPV {i.respondidas}/{i.total}</span>;
  if (i.estado === "pendiente") return <span className="text-[12px] text-brand-slate">IPV con link</span>;
  return <span className="text-[12px] text-brand-mist">Sin IPV</span>;
}

function TarjetaPostulante({ p, link, onEstado, onLink }: { p: Postulante; link: boolean; onEstado: () => void; onLink: () => void }) {
  return (
    <li className="px-4 py-3">
      <Link href={`${CAP_HREF}/postulantes/${p.id}`} className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[15px] text-brand-ink">{p.apellido}, {p.nombre}</div>
          <div className="text-[13px] text-brand-slate">CI {p.ci} · {p.edad} años · {SEXO_CORTO[p.sexo]}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1"><EstadoTag estado={p.estado} /><IpvChip p={p} />
            <span className="text-[12px] text-brand-slate">{p.comentarios.feedback + p.comentarios.oportunidad} feedback</span></div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <MetaEntrenamientos hechos={p.avance.terminados} meta={p.avance.meta} compacta />
            {p.avance.pct !== null && p.avance.pct < 100 && <span className="text-[12px] text-brand-slate tabular-nums">avance {p.avance.pct}%</span>}
            {p.avance.aprobados > 0 && <span className="text-[12px] text-emerald-700 font-semibold">{p.avance.aprobados} recomendado{p.avance.aprobados > 1 ? "s" : ""}</span>}
          </div>
          {p.avance.resultado && <div className="mt-1"><MediaEntrenamientos r={p.avance.resultado} linea /></div>}
        </div>
        <ChevronRight size={18} className="text-brand-mist mt-1 shrink-0" aria-hidden />
      </Link>
      {(p.puede.length > 0 || link) && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {p.puede.length > 0 && <button type="button" onClick={onEstado} className="btn min-h-[44px] text-sm border border-brand-border bg-white">Cambiar estado</button>}
          {link && p.estado !== "abandono" && p.estado !== "baja" && (
            <button type="button" onClick={onLink} className="btn min-h-[44px] text-sm border border-brand-border bg-white"><Send size={16} aria-hidden /> Enviar</button>
          )}
        </div>
      )}
    </li>
  );
}

function TablaPostulantes({ lista, link, onEstado, onLink }: { lista: Postulante[]; link: boolean; onEstado: (p: Postulante) => void; onLink: (p: Postulante) => void }) {
  const router = useRouter();
  return (
    <div className="hidden md:block card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
            <th className="px-4 py-2.5 font-semibold">Postulante</th><th className="px-3 py-2.5 font-semibold">CI</th>
            <th className="px-3 py-2.5 font-semibold">Edad · sexo</th><th className="px-3 py-2.5 font-semibold">Estado</th>
            <th className="px-3 py-2.5 font-semibold">Entrenamientos</th>
            <th className="px-3 py-2.5 font-semibold" title="Media de todas sus conversaciones evaluadas: nivel comercial de 1 a 10 e información correcta">Resultado medio</th>
            <th className="px-3 py-2.5 font-semibold">IPV</th>
            <th className="px-3 py-2.5 font-semibold text-right">Feedback</th>
            <th className="px-4 py-2.5 font-semibold text-right">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-border">
          {lista.map((p) => (
            <tr key={p.id} className="hover:bg-brand-bg-soft cursor-pointer" onClick={() => router.push(`${CAP_HREF}/postulantes/${p.id}`)}>
              <td className="px-4 py-2.5"><Link href={`${CAP_HREF}/postulantes/${p.id}`} className="font-semibold text-brand-ink hover:text-brand-primary">{p.apellido}, {p.nombre}</Link></td>
              <td className="px-3 py-2.5 tabular-nums">{p.ci}</td>
              <td className="px-3 py-2.5 tabular-nums">{p.edad} · {SEXO_CORTO[p.sexo]}</td>
              <td className="px-3 py-2.5"><EstadoTag estado={p.estado} />{p.motivo && <div className="text-xs text-brand-slate mt-0.5 max-w-[220px] truncate" title={p.motivo}>{p.motivo}</div>}</td>
              <td className="px-3 py-2.5"><MetaEntrenamientos hechos={p.avance.terminados} meta={p.avance.meta} compacta />
                {p.avance.pct !== null && <div className="text-[11px] text-brand-slate tabular-nums">avance {p.avance.pct}%{p.avance.aprobados > 0 && ` · ${p.avance.aprobados} recomendado${p.avance.aprobados > 1 ? "s" : ""}`}</div>}</td>
              <td className="px-3 py-2.5"><MediaEntrenamientos r={p.avance.resultado} /></td>
              <td className="px-3 py-2.5"><IpvChip p={p} /></td>
              <td className="px-3 py-2.5 text-right tabular-nums">{p.comentarios.feedback + p.comentarios.oportunidad}
                {p.comentarios.postulante > 0 && <span className="text-xs text-brand-slate"> · {p.comentarios.postulante} suyo{p.comentarios.postulante > 1 ? "s" : ""}</span>}</td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                {p.puede.length > 0 && <button type="button" onClick={() => onEstado(p)} className="btn-ghost text-xs">Estado</button>}
                {link && p.estado !== "abandono" && p.estado !== "baja" && <button type="button" onClick={() => onLink(p)} className="btn-ghost text-xs">Enviar</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IpvGrupo({ r }: { r: ResumenIpv }) {
  if (!r.realizados) return <div className="card p-6 text-sm text-brand-slate text-center">Nadie terminó el IPV todavía.{r.en_curso ? ` ${r.en_curso} lo están haciendo.` : ""}</div>;
  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(["superior", "termino_medio", "inferior"] as const).map((n) => <Etiqueta key={n}>{r.dgv[n]} con DGV {NIVEL_IPV[n].nombre.toLowerCase()}</Etiqueta>)}
      </div>
      {r.promedios.filter((x) => x.decatipo !== null).map((x) => (
        <div key={x.clave} className={cx(!x.romano && "font-semibold")}>
          <div className="flex justify-between text-[13px]"><span className="text-brand-ink">{x.romano && <span className="text-brand-mist mr-1">{x.romano}</span>}{x.nombre}</span>
            <span className="tabular-nums text-brand-slate">{x.decatipo}</span></div>
          <div className="mt-0.5"><Barra valor={x.decatipo} max={10} color={(x.decatipo ?? 0) >= 8 ? NIVEL_IPV.superior.color : (x.decatipo ?? 0) >= 4 ? NIVEL_IPV.termino_medio.color : NIVEL_IPV.inferior.color} /></div>
        </div>
      ))}
    </div>
  );
}

function HojaEstadoGrupo({ g, onClose, onListo }: { g: GrupoDetalle; onClose: () => void; onListo: (g: GrupoDetalle) => void }) {
  const [estado, setEstado] = useState<EstadoGrupo | null>(g.puede.estados.length === 1 ? g.puede.estados[0] : null);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const NOMBRE: Record<EstadoGrupo, string> = { finalizada: "Finalizar", cancelada: "Cancelar", en_curso: "Volver a en curso" };
  const guardar = async () => {
    setOcupado(true); setError(null);
    try { onListo(await apiFetch<GrupoDetalle>(`${CAP_API}/grupos/${g.id}/estado`, { method: "POST", body: JSON.stringify({ estado, motivo: motivo || null }) })); }
    catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  return (
    <Hoja titulo="Estado del grupo" sobre={g.nombre} onClose={onClose} ocupada={ocupado}
      pie={<Boton onClick={guardar} ocupado={ocupado} tipo={estado === "cancelada" ? "peligro" : "primario"} disabled={!estado || (estado === "cancelada" && motivo.trim().length < 3)}>Guardar</Boton>}>
      <div className="space-y-4">
        <p className="text-sm text-brand-slate">Ahora: <b className="text-brand-ink">{ESTADOS_GRUPO[g.estado].nombre}</b> · {diasTexto(g.duracion_dias)}</p>
        <Chips etiqueta="Nuevo estado" opciones={g.puede.estados.map((v) => ({ v, label: NOMBRE[v] }))} valor={estado ? [estado] : []} onChange={(v) => setEstado(v[0] ?? null)} />
        {estado === "finalizada" && <p className="text-sm text-brand-slate">La duración del grupo queda fija hasta hoy. El mentor puede seguir cargando las altas.</p>}
        {estado === "cancelada" && (
          <div><label className="label" htmlFor="mc">¿Por qué se cancela?</label>
            <input id="mc" className="input" value={motivo} maxLength={500} onChange={(e) => setMotivo(e.target.value)} />
            <p className="text-[11px] text-brand-mist mt-1">Un grupo cancelado queda de solo lectura y los links de los postulantes dejan de funcionar.</p></div>
        )}
        {error && <Fallo>{error}</Fallo>}
      </div>
    </Hoja>
  );
}

/** Enviar un entrenamiento al grupo: primero se elige cuál, después los postulantes. */
function EnviarAlGrupo({ grupoId, onClose }: { grupoId: string; onClose: () => void }) {
  const [d, setD] = useState<{ entrenamientos: EntrenamientoFila[]; meta: number } | null>(null);
  const [elegido, setElegido] = useState<EntrenamientoFila | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { apiFetch<{ entrenamientos: EntrenamientoFila[]; meta: number }>(`${CAP_API}/entrenamientos`).then(setD).catch((e) => setError(e.message)); }, []);
  if (elegido && d) return <HojaEnviar eid={elegido.id} nombre={elegido.nombre} meta={d.meta} borrador={elegido.estado === "borrador"} grupoInicial={grupoId} onClose={onClose} />;
  // Primero los activos; los borradores, después y marcados (al enviarlos se activan).
  const lista = (d?.entrenamientos ?? []).filter((e) => e.estado !== "archivado" && e.casos > 0)
    .sort((x, y) => Number(x.estado === "borrador") - Number(y.estado === "borrador"));
  return (
    <Hoja titulo="Enviar entrenamiento" sobre="Elegí cuál" onClose={onClose}>
      {error && <Fallo>{error}</Fallo>}
      {!d && !error && <div className="h-32 rounded-lg bg-brand-bg animate-pulse" />}
      {d && lista.length === 0 && (
        <p className="text-sm text-brand-slate">No hay entrenamientos listos. <Link href={`${CAP_HREF}/entrenamientos`} className="font-semibold text-brand-primary">Crear uno</Link></p>
      )}
      <ul className="space-y-2">
        {lista.map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => setElegido(e)} className="w-full text-left card px-4 py-3 flex items-center gap-3 min-h-[60px] hover:border-brand-ink">
              <span className="min-w-0 flex-1"><span className="flex items-center gap-2 flex-wrap font-semibold text-[15px] text-brand-ink">{e.nombre}
                {e.estado === "borrador" && <Etiqueta tono="naranja">Borrador</Etiqueta>}</span>
                <span className="block text-[12px] text-brand-slate">{e.casos} caso{e.casos === 1 ? "" : "s"} · enviado a {e.enviados}{e.estado === "borrador" && " · se activa al enviarlo"}</span></span>
              <ChevronRight size={18} className="text-brand-mist" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </Hoja>
  );
}
