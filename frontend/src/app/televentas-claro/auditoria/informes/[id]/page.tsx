"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { GraficoAuditoria, tituloGrafico } from "@/components/auditoria/GraficoAuditoria";
import { Hallazgos } from "@/components/auditoria/Hallazgos";
import { InformeEjecutivo } from "@/components/auditoria/InformeEjecutivo";
import { InformeImpreso } from "@/components/auditoria/InformeImpreso";
import { RiesgosView } from "@/components/auditoria/RiesgosView";
import { Seguimiento } from "@/components/auditoria/Seguimiento";
import {
  ACCION_ESTADO, AUD_API, AUD_HREF, CATALOGO_GRAFICOS, ESTADO_AUD_LABEL, fechaCorta, fechaHora, n, nombrePeriodo, rangoPeriodos,
  type AuditoriaDetalle, type EstadoAuditoria, type GraficoElegido,
} from "@/components/auditoria/tipos";
import { Tabs } from "@/components/ventas-netas/ui";
import { apiFetch } from "@/lib/api";

type Vista = "resumen" | "hallazgos" | "graficos" | "seguimiento" | "redaccion" | "informe";
const ESTADO_CLS: Record<EstadoAuditoria, string> = { borrador: "badge-cyan", en_revision: "badge-primary", cerrado: "badge-success", archivado: "badge-neutral" };

export default function InformeAuditoriaPage() {
  return (
    <AppShell>
      <Informe />
    </AppShell>
  );
}

function Informe() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [a, setA] = useState<AuditoriaDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>("resumen");
  const [transicion, setTransicion] = useState<EstadoAuditoria | null>(null);
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [eliminar, setEliminar] = useState(false);
  const [modo, setModo] = useState<"ejecutivo" | "extenso">("ejecutivo");
  const [actualizar, setActualizar] = useState(false);

  const load = useCallback(async () => {
    try { setA(await apiFetch<AuditoriaDetalle>(`${AUD_API}/informes/${id}`)); } catch (e: any) { setError(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const cambiarEstado = async () => {
    if (!transicion) return;
    setOcupado(true);
    try {
      await apiFetch(`${AUD_API}/informes/${id}/estado`, { method: "POST", body: JSON.stringify({ status: transicion, nota: nota || null }) });
      setTransicion(null);
      setNota("");
      await load();
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  const imprimir = (m: "ejecutivo" | "extenso") => {
    setModo(m);
    setVista("informe");
    setTimeout(() => window.print(), 600);
  };
  const actualizarDatos = async () => {
    setOcupado(true);
    try {
      setA(await apiFetch<AuditoriaDetalle>(`${AUD_API}/informes/${id}/actualizar`, { method: "POST" }));
      setActualizar(false);
    } catch (e: any) { setError(e.message); setActualizar(false); } finally { setOcupado(false); }
  };

  if (error && !a) return <div className="card p-8 text-brand-primary">{error}</div>;
  if (!a) return <div className="card p-10 text-brand-slate">Cargando…</div>;

  const nombre = (uid: string | null) => (uid && a.usuarios[uid]) || "—";

  return (
    <>
      <div className="mb-5 print:hidden">
        <Link href={AUD_HREF} className="text-xs text-brand-slate hover:text-brand-primary">← Informes de auditoría</Link>
        <div className="flex items-start justify-between gap-4 flex-wrap mt-1">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-semibold text-brand-slate">{a.codigo}</span>
              <span className={ESTADO_CLS[a.status]}>{ESTADO_AUD_LABEL[a.status]}</span>
            </div>
            <h1 className="font-display text-3xl text-brand-ink uppercase leading-tight">{a.titulo}</h1>
            <p className="text-sm text-brand-slate mt-1">
              {rangoPeriodos(a)} · fuentes: {a.fuentes.map((f) => `${nombrePeriodo(f.periodo)} corte ${fechaCorta(f.fecha_dato)}`).join(", ")} · auditor {nombre(a.created_by)} · {fechaHora(a.created_at)}
              {a.closed_at && <> · cerrado por {nombre(a.closed_by)} el {fechaHora(a.closed_at)}</>}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {a.transiciones.map((t) => (
              <button key={t} onClick={() => setTransicion(t)} className={t === "cerrado" || t === "en_revision" && a.status === "borrador" ? "btn-primary" : "btn-secondary"}>
                {ACCION_ESTADO[t][a.status]}
              </button>
            ))}
            <button onClick={() => setVista("informe")} className="btn-secondary">Informe PDF</button>
            {a.puede_eliminar && <button onClick={() => setEliminar(true)} className="btn-ghost text-brand-primary">Eliminar</button>}
          </div>
        </div>
        {error && <div className="card p-3 text-brand-primary text-sm mt-3">{error}</div>}
        {a.reglas_desactualizadas && (
          <div className="mt-4 rounded-lg border border-brand-orange/40 bg-brand-orange/10 p-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="text-sm text-brand-graphite max-w-3xl">
              <b className="text-[#B86E00]">Este informe se generó con reglas anteriores.</b> Hoy las líneas activadas hace menos de 3 días al corte quedan en espera de uso y no son alerta, y crítico es el vendedor con más de 35% de líneas sin uso.
              {a.editable ? " Podés actualizar los datos: los hallazgos que ya trabajaste se conservan." : " Está cerrado: conserva los datos con los que se emitió."}
            </div>
            {a.editable && <button onClick={() => setActualizar(true)} className="btn-primary whitespace-nowrap">Actualizar con el criterio vigente</button>}
          </div>
        )}
      </div>

      <div className="print:hidden">
        <Tabs<Vista>
          value={vista}
          onChange={setVista}
          items={[
            { value: "resumen", label: "Resumen", hint: "Riesgos y ranking" },
            { value: "hallazgos", label: `Hallazgos (${n(a.hallazgos.length)})`, hint: `${n(a.hallazgos_abiertos)} abiertos` },
            { value: "graficos", label: `Gráficos (${n(a.graficos.length)})`, hint: "Elegidos para el informe" },
            { value: "seguimiento", label: "Seguimiento", hint: `${n(a.seguimientos.length)} movimientos` },
            { value: "redaccion", label: "Redacción", hint: "Alcance · resumen · conclusiones" },
            { value: "informe", label: "Informe", hint: "Vista para imprimir" },
          ]}
        />
      </div>

      {vista === "resumen" && <RiesgosView s={a.snapshot} />}
      {vista === "hallazgos" && <Hallazgos a={a} onChange={load} />}
      {vista === "graficos" && <Graficos a={a} onChange={load} />}
      {vista === "seguimiento" && <Seguimiento a={a} onChange={load} />}
      {vista === "redaccion" && <Redaccion a={a} onChange={load} />}
      {vista === "informe" && (
        <>
          <div className="grid md:grid-cols-2 gap-4 mb-5 no-print">
            {([
              ["ejecutivo", "Informe ejecutivo", "Para la Gerencia: resumen del auditor, indicadores, hallazgos, gráficos con tus comentarios, vendedores críticos, conclusiones y recomendaciones.", ["Resumen", "Indicadores", "Hallazgos", "Gráficos y comentarios", "Críticos", "Conclusiones"]],
              ["extenso", "Informe extenso", "Con todas las detecciones: datos llamativos, hallazgos con su evidencia línea por línea, vendedores riesgosos, bitácora de seguimiento y anexo completo.", ["Todo el ejecutivo", "Datos llamativos", "Evidencia completa", "Vendedores riesgosos", "Seguimiento", "Anexo"]],
            ] as const).map(([m, titulo, texto, chips]) => (
              <div key={m} role="button" tabIndex={0} onClick={() => setModo(m)} onKeyDown={(e) => e.key === "Enter" && setModo(m)}
                className={`card p-5 cursor-pointer transition-all border-2 ${modo === m ? "border-brand-primary shadow-elevated" : "border-transparent hover:border-brand-border"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">{m === "ejecutivo" ? "Versión corta" : "Versión completa"}</div>
                    <div className="font-display text-2xl uppercase text-brand-ink leading-tight">{titulo}</div>
                  </div>
                  <span className={`w-5 h-5 rounded-full border-2 grid place-items-center ${modo === m ? "border-brand-primary" : "border-brand-mist"}`}>{modo === m && <span className="w-2.5 h-2.5 rounded-full bg-brand-primary" />}</span>
                </div>
                <p className="text-sm text-brand-graphite mt-2 leading-snug">{texto}</p>
                <div className="flex flex-wrap gap-1.5 mt-3">{chips.map((c) => <span key={c} className="rounded border border-brand-border px-2 py-0.5 text-[11px] text-brand-slate">{c}</span>)}</div>
                <button onClick={(e) => { e.stopPropagation(); imprimir(m); }} className={`mt-4 w-full ${modo === m ? "btn-primary" : "btn-secondary"}`}>
                  Descargar PDF para enviar
                </button>
              </div>
            ))}
          </div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2 no-print">Vista previa · {modo === "ejecutivo" ? "informe ejecutivo" : "informe extenso"}</div>
          <div className="card p-8 informe-impreso-card">
            {modo === "ejecutivo" ? <InformeEjecutivo a={a} /> : <InformeImpreso a={a} />}
          </div>
        </>
      )}

      <ConfirmDialog
        open={actualizar}
        title="Actualizar con el criterio vigente"
        confirmLabel="Actualizar datos"
        loading={ocupado}
        onCancel={() => setActualizar(false)}
        onConfirm={actualizarDatos}
        message="Se vuelven a congelar los datos desde las mismas fuentes con las reglas de hoy. Los hallazgos automáticos que nadie tocó se regeneran; los manuales y los que editaste, cambiaste de estado o comentaste se conservan. Queda registrado en el seguimiento."
      />
      <ConfirmDialog
        open={!!transicion}
        variant={transicion === "cerrado" || transicion === "archivado" ? "danger" : "default"}
        title={transicion ? ACCION_ESTADO[transicion][a.status] : ""}
        confirmLabel="Confirmar"
        loading={ocupado}
        onCancel={() => setTransicion(null)}
        onConfirm={cambiarEstado}
        message={transicion && (
          <div className="space-y-3">
            <p>
              {transicion === "en_revision" && a.status === "borrador" && "El informe pasa a revisión de la coordinación. Se puede volver a borrador o cerrar."}
              {transicion === "borrador" && "El informe vuelve a borrador para seguir editándolo."}
              {transicion === "cerrado" && <>Se <b>emite</b> el informe: la redacción, los gráficos y los hallazgos quedan fijos. El seguimiento de los hallazgos sigue abierto.</>}
              {transicion === "en_revision" && a.status === "cerrado" && "Se reabre el informe para corregirlo. Queda registrado en el historial."}
              {transicion === "archivado" && "El seguimiento terminó: el informe pasa a solo lectura."}
            </p>
            <textarea className="input min-h-[70px]" placeholder="Nota (opcional): motivo, a quién se entregó…" value={nota} onChange={(e) => setNota(e.target.value)} />
          </div>
        )}
      />
      <ConfirmDialog
        open={eliminar}
        variant="danger"
        title="Eliminar borrador"
        confirmLabel="Eliminar"
        loading={ocupado}
        message={<>Se elimina el borrador <b>{a.codigo}</b> con sus hallazgos y seguimiento. Queda registrado en auditoría.</>}
        onCancel={() => setEliminar(false)}
        onConfirm={async () => {
          setOcupado(true);
          try { await apiFetch(`${AUD_API}/informes/${id}`, { method: "DELETE" }); router.push(AUD_HREF); }
          catch (e: any) { setError(e.message); setOcupado(false); setEliminar(false); }
        }}
      />
    </>
  );
}

/** Gráficos elegidos por el auditor para el informe: catálogo, orden, título y nota. */
function Graficos({ a, onChange }: { a: AuditoriaDetalle; onChange: () => Promise<void> }) {
  const [lista, setLista] = useState<GraficoElegido[]>(a.graficos);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setLista(a.graficos), [a.graficos]);
  const cambiado = JSON.stringify(lista) !== JSON.stringify(a.graficos);

  const guardar = async () => {
    setOcupado(true);
    setError(null);
    try { await apiFetch(`${AUD_API}/informes/${a.id}`, { method: "PATCH", body: JSON.stringify({ graficos: lista }) }); await onChange(); }
    catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  const mover = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= lista.length) return;
    const l = [...lista];
    [l[i], l[j]] = [l[j], l[i]];
    setLista(l);
  };

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="space-y-3">
        <div className="card p-4">
          <h3 className="font-display text-lg text-brand-ink uppercase mb-1">Catálogo</h3>
          <p className="text-xs text-brand-slate mb-3">Agregá los gráficos que quieras incluir en el informe. Se imprimen en el orden de la derecha.</p>
          <ul className="space-y-1.5">
            {CATALOGO_GRAFICOS.map((c) => {
              const usado = lista.some((g) => g.key === c.key);
              return (
                <li key={c.key} className="flex items-start justify-between gap-2 rounded-md border border-brand-border p-2">
                  <div>
                    <div className="text-sm font-semibold text-brand-ink">{c.titulo}</div>
                    <div className="text-[11px] text-brand-slate">{c.descripcion}</div>
                  </div>
                  <button disabled={usado || !a.editable} onClick={() => setLista([...lista, { key: c.key }])} className="btn-ghost text-xs whitespace-nowrap">{usado ? "Incluido" : "Agregar"}</button>
                </li>
              );
            })}
          </ul>
        </div>
        {a.editable && (
          <button onClick={guardar} disabled={!cambiado || ocupado} className="btn-primary w-full">{ocupado ? "Guardando…" : cambiado ? "Guardar gráficos" : "Sin cambios"}</button>
        )}
        {!a.editable && <p className="text-xs text-brand-slate">Informe {ESTADO_AUD_LABEL[a.status].toLowerCase()}: los gráficos no se modifican.</p>}
        {error && <div className="text-sm text-brand-primary">{error}</div>}
      </div>
      <div className="lg:col-span-2 space-y-4">
        {lista.length === 0 && <div className="card p-10 text-center text-brand-slate">Ningún gráfico elegido.</div>}
        {lista.map((g, i) => (
          <div key={`${g.key}-${i}`} className="card p-4">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-xs font-semibold text-brand-slate">{i + 1}.</span>
              <input className="input flex-1 min-w-[200px]" placeholder={tituloGrafico(g.key)} value={g.titulo ?? ""} disabled={!a.editable} onChange={(e) => setLista(lista.map((x, j) => (j === i ? { ...x, titulo: e.target.value || undefined } : x)))} />
              {a.editable && (
                <div className="flex gap-1">
                  <button onClick={() => mover(i, -1)} className="btn-ghost text-xs" title="Subir">↑</button>
                  <button onClick={() => mover(i, 1)} className="btn-ghost text-xs" title="Bajar">↓</button>
                  <button onClick={() => setLista(lista.filter((_, j) => j !== i))} className="btn-ghost text-xs text-brand-primary">Quitar</button>
                </div>
              )}
            </div>
            <GraficoAuditoria s={a.snapshot} clave={g.key} alto={260} />
            <textarea className="input mt-2 min-h-[56px] text-sm" placeholder="Nota del auditor sobre este gráfico (opcional)" value={g.nota ?? ""} disabled={!a.editable} onChange={(e) => setLista(lista.map((x, j) => (j === i ? { ...x, nota: e.target.value || undefined } : x)))} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Redacción del informe: alcance, resumen ejecutivo, conclusiones y recomendaciones. */
function Redaccion({ a, onChange }: { a: AuditoriaDetalle; onChange: () => Promise<void> }) {
  const [form, setForm] = useState({ titulo: a.titulo, alcance: a.alcance ?? "", resumen: a.resumen ?? "", conclusiones: a.conclusiones ?? "", recomendaciones: a.recomendaciones ?? "" });
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState<string | null>(null);
  useEffect(() => setForm({ titulo: a.titulo, alcance: a.alcance ?? "", resumen: a.resumen ?? "", conclusiones: a.conclusiones ?? "", recomendaciones: a.recomendaciones ?? "" }), [a]);
  const cambiado = form.titulo !== a.titulo || form.alcance !== (a.alcance ?? "") || form.resumen !== (a.resumen ?? "") || form.conclusiones !== (a.conclusiones ?? "") || form.recomendaciones !== (a.recomendaciones ?? "");

  const guardar = async () => {
    setOcupado(true);
    setError(null);
    try {
      await apiFetch(`${AUD_API}/informes/${a.id}`, { method: "PATCH", body: JSON.stringify(form) });
      await onChange();
      setGuardado(new Date().toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" }));
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };
  const campo = (key: keyof typeof form, label: string, ayuda: string, alto = "min-h-[140px]") => (
    <div>
      <label className="label">{label}</label>
      <textarea className={`input ${alto}`} value={form[key]} disabled={!a.editable} onChange={(e) => setForm({ ...form, [key]: e.target.value })} placeholder={ayuda} />
    </div>
  );

  return (
    <div className="max-w-4xl space-y-4">
      {!a.editable && <div className="card p-3 text-sm text-brand-slate">Informe {ESTADO_AUD_LABEL[a.status].toLowerCase()}: la redacción quedó fija. Reabrilo para corregirla.</div>}
      <div>
        <label className="label">Título del informe</label>
        <input className="input" value={form.titulo} disabled={!a.editable} onChange={(e) => setForm({ ...form, titulo: e.target.value })} />
      </div>
      {campo("alcance", "Alcance", "Qué se auditó, con qué fuentes y criterios.", "min-h-[100px]")}
      {campo("resumen", "Resumen ejecutivo", "El sistema propone un borrador a partir de los datos; ajustalo con la lectura del auditor.")}
      {campo("conclusiones", "Conclusiones", "Qué se concluye del análisis y de los hallazgos.")}
      {campo("recomendaciones", "Recomendaciones", "Acciones concretas, responsables y plazos.")}
      {a.editable && (
        <div className="flex items-center gap-3">
          <button onClick={guardar} disabled={!cambiado || ocupado} className="btn-primary">{ocupado ? "Guardando…" : "Guardar redacción"}</button>
          {guardado && !cambiado && <span className="text-xs text-emerald-700">Guardado {guardado}</span>}
          {error && <span className="text-sm text-brand-primary">{error}</span>}
        </div>
      )}
    </div>
  );
}
