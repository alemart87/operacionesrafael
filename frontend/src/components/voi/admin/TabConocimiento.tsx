"use client";

import {
  BookOpen, Download, Eye, FileText, Loader2, Lock, Pencil, RefreshCw, Search, ShieldCheck, Trash2, Upload, Users, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { apiFetch, downloadFile } from "@/lib/api";
import { VOI_API, cuando } from "@/lib/voi";
import { num } from "./tipos";

type TipoAlcance = "todos" | "permisos" | "superadmin";
interface Alcance { tipo: TipoAlcance; permisos: string[] }
interface DocumentoVoi {
  id: string; titulo: string; descripcion: string; archivo: string; mime: string; bytes: number; paginas: number | null;
  alcance: Alcance; activo: boolean; caracteres: number; fragmentos: number; created_at: string | null;
  updated_at: string | null; subido_por: string | null; editado_por: string | null;
}
interface PermisoVoi { clave: string; nombre: string; operativa: string }
interface ListaDocs { items: DocumentoVoi[]; permisos: PermisoVoi[]; formatos: string[]; max_mb: number }
interface Fragmento { id: string; orden: number; pagina: number | null; seccion: string | null; texto: string }
interface Resultado { cita: string; fragmento_id: string; documento: string; documento_id: string; pagina: number | null; seccion: string | null; texto: string; relevancia: number; terminos_encontrados: string }

const DOCS = `${VOI_API}/admin/documentos`;
const ACEPTA = ".pdf,.docx,.txt,.md";

const peso = (b: number) => (b >= 1048576 ? `${(b / 1048576).toLocaleString("es-PY", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const extension = (n: string) => (n.split(".").pop() || "").toUpperCase();

function AlcanceBadge({ a, permisos }: { a: Alcance; permisos: PermisoVoi[] }) {
  if (a.tipo === "superadmin") return <span className="badge-neutral inline-flex items-center gap-1"><Lock size={10} /> Solo superadmin</span>;
  if (a.tipo === "permisos") {
    const nombres = a.permisos.map((p) => permisos.find((x) => x.clave === p)?.nombre ?? p);
    return <span className="badge-purple inline-flex items-center gap-1" title={nombres.join(" · ")}><ShieldCheck size={10} /> {nombres.length === 1 ? nombres[0] : `${nombres.length} permisos`}</span>;
  }
  return <span className="badge-cyan inline-flex items-center gap-1"><Users size={10} /> Todos</span>;
}

/** Quién lo consulta: todos los que usan Voi, solo quienes tienen ciertos permisos, o solo el superadmin. */
function EditorAlcance({ valor, onChange, permisos }: { valor: Alcance; onChange: (a: Alcance) => void; permisos: PermisoVoi[] }) {
  const [filtro, setFiltro] = useState("");
  const visibles = permisos.filter((p) => !filtro || `${p.nombre} ${p.operativa}`.toLowerCase().includes(filtro.toLowerCase()));
  const opcion = (tipo: TipoAlcance, titulo: string, detalle: string, icono: React.ReactNode) => (
    <button type="button" role="radio" aria-checked={valor.tipo === tipo} onClick={() => onChange({ tipo, permisos: tipo === "permisos" ? valor.permisos : [] })}
      className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${valor.tipo === tipo ? "border-brand-primary bg-brand-primary-light/60 ring-1 ring-brand-primary/30" : "border-brand-border hover:bg-brand-bg-soft"}`}>
      <span className="flex items-center gap-2 text-sm font-semibold text-brand-ink">{icono} {titulo}</span>
      <span className="block text-[11px] text-brand-slate mt-0.5 leading-snug">{detalle}</span>
    </button>
  );
  return (
    <div>
      <span className="label">Quién lo puede consultar</span>
      <div className="grid sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Alcance del documento">
        {opcion("todos", "Todos", "Cualquier persona que usa Voi.", <Users size={14} className="text-brand-cyan" />)}
        {opcion("permisos", "Con permisos", "Solo quien tiene alguno de los permisos elegidos (p. ej. Facturación).", <ShieldCheck size={14} className="text-brand-purple" />)}
        {opcion("superadmin", "Solo vos", "Únicamente el superadmin.", <Lock size={14} className="text-brand-slate" />)}
      </div>
      {valor.tipo === "permisos" && (
        <div className="mt-2 rounded-xl border border-brand-border">
          <div className="p-2 border-b border-brand-border">
            <input className="input py-1.5" placeholder="Filtrar permisos…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
          </div>
          <ul className="max-h-48 overflow-y-auto p-1.5">
            {visibles.map((p) => {
              const marcado = valor.permisos.includes(p.clave);
              return (
                <li key={p.clave}>
                  <label className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-brand-bg cursor-pointer">
                    <input type="checkbox" className="mt-0.5 accent-brand-primary" checked={marcado}
                      onChange={() => onChange({ tipo: "permisos", permisos: marcado ? valor.permisos.filter((x) => x !== p.clave) : [...valor.permisos, p.clave] })} />
                    <span className="min-w-0">
                      <span className="block text-sm text-brand-ink">{p.nombre}</span>
                      <span className="block text-[11px] text-brand-mist">{p.operativa}</span>
                    </span>
                  </label>
                </li>
              );
            })}
            {!visibles.length && <li className="px-2 py-3 text-xs text-brand-mist">Ningún permiso coincide.</li>}
          </ul>
          {!valor.permisos.length && <p className="px-3 pb-2 text-[11px] text-brand-primary">Elegí al menos un permiso.</p>}
        </div>
      )}
    </div>
  );
}

function Subir({ lista, onListo, onCerrar }: { lista: ListaDocs; onListo: () => void; onCerrar: () => void }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [alcance, setAlcance] = useState<Alcance>({ tipo: "todos", permisos: [] });
  const [arrastrando, setArrastrando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const elegir = (f: File | undefined | null) => {
    if (!f) return;
    setError(null);
    if (!lista.formatos.some((x) => f.name.toLowerCase().endsWith(x))) return setError("Formato no admitido: PDF, Word (.docx), .txt o .md.");
    if (f.size > lista.max_mb * 1048576) return setError(`El archivo supera ${lista.max_mb} MB.`);
    setArchivo(f);
    if (!titulo) setTitulo(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim());
  };
  const valido = !!archivo && titulo.trim().length > 0 && (alcance.tipo !== "permisos" || alcance.permisos.length > 0);
  const enviar = async () => {
    if (!archivo || !valido) return;
    setEnviando(true);
    setError(null);
    const fd = new FormData();
    fd.append("archivo", archivo);
    fd.append("titulo", titulo.trim());
    fd.append("descripcion", descripcion.trim());
    fd.append("alcance", JSON.stringify(alcance));
    try {
      await apiFetch(DOCS, { method: "POST", body: fd });
      onListo();
    } catch (e: any) {
      setError(e.message);
    }
    setEnviando(false);
  };

  return (
    <section className="card p-5 animate-pop">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg text-brand-ink uppercase">Subir un documento</h3>
          <p className="text-xs text-brand-slate mt-0.5">PDF con texto (no escaneado), Word (.docx), .txt o .md · hasta {lista.max_mb} MB.</p>
        </div>
        <button type="button" onClick={onCerrar} className="p-1.5 rounded-lg text-brand-slate hover:bg-brand-bg" aria-label="Cerrar"><X size={16} /></button>
      </div>
      <div className="mt-4 grid lg:grid-cols-2 gap-5">
        <div className="space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={(e) => { e.preventDefault(); setArrastrando(false); elegir(e.dataTransfer.files?.[0]); }}
            onClick={() => input.current?.click()}
            role="button" tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
            className={`rounded-xl border-2 border-dashed px-4 py-7 text-center cursor-pointer transition-colors ${arrastrando ? "border-brand-primary bg-brand-primary-light/50" : "border-brand-border hover:border-brand-primary/60 hover:bg-brand-bg-soft"}`}>
            <input ref={input} type="file" accept={ACEPTA} className="hidden" onChange={(e) => elegir(e.target.files?.[0])} />
            {archivo ? (
              <div className="flex items-center justify-center gap-3">
                <span className="grid place-items-center w-10 h-10 rounded-lg bg-brand-bg text-[10px] font-bold text-brand-slate">{extension(archivo.name)}</span>
                <span className="text-left min-w-0">
                  <span className="block text-sm font-semibold text-brand-ink truncate max-w-[260px]">{archivo.name}</span>
                  <span className="block text-xs text-brand-slate">{peso(archivo.size)} · tocá para cambiarlo</span>
                </span>
              </div>
            ) : (
              <>
                <Upload size={22} className="mx-auto text-brand-mist" />
                <p className="mt-2 text-sm font-semibold text-brand-ink">Arrastrá el archivo o tocá para elegirlo</p>
                <p className="text-xs text-brand-slate">Manuales, políticas, procedimientos, criterios…</p>
              </>
            )}
          </div>
          <label className="block">
            <span className="label">Título</span>
            <input className="input" value={titulo} maxLength={200} onChange={(e) => setTitulo(e.target.value)} placeholder="Manual de comisiones 2026" />
            <span className="block mt-1 text-[11px] text-brand-mist">Es lo que se ve en las citas de Voi.</span>
          </label>
          <label className="block">
            <span className="label">Qué contiene</span>
            <textarea className="input min-h-[72px]" value={descripcion} maxLength={2000} onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Cuotas, chargeback, PFI y escalas de bonos de Pospago y GPON." />
            <span className="block mt-1 text-[11px] text-brand-mist">Ayuda a Voi a saber cuándo buscar en este documento.</span>
          </label>
        </div>
        <div className="space-y-4">
          <EditorAlcance valor={alcance} onChange={setAlcance} permisos={lista.permisos} />
          <div className="rounded-xl bg-brand-bg-soft border border-brand-border px-3.5 py-3 text-xs text-brand-slate leading-relaxed">
            Voi lee el texto, lo parte en fragmentos con su página y sección y responde citándolos: el usuario toca la cita y ve el
            pasaje exacto. Nunca ve un documento fuera de su alcance. Todo cambio queda en la auditoría.
          </div>
          {error && <p className="text-sm text-brand-primary">{error}</p>}
          <div className="flex justify-end gap-2">
            <button className="btn-secondary text-sm" onClick={onCerrar} disabled={enviando}>Cancelar</button>
            <button className="btn-primary text-sm" onClick={enviar} disabled={!valido || enviando}>
              {enviando ? <><Loader2 size={15} className="animate-spin" /> Leyendo el documento…</> : <><Upload size={15} /> Subir</>}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Editar({ doc, permisos, onListo, onCerrar }: { doc: DocumentoVoi; permisos: PermisoVoi[]; onListo: () => void; onCerrar: () => void }) {
  const [titulo, setTitulo] = useState(doc.titulo);
  const [descripcion, setDescripcion] = useState(doc.descripcion);
  const [alcance, setAlcance] = useState<Alcance>(doc.alcance);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const archivo = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === "Escape" && !ocupado && onCerrar();
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [ocupado, onCerrar]);

  const guardar = async () => {
    setOcupado("guardar");
    setError(null);
    try {
      await apiFetch(`${DOCS}/${doc.id}`, { method: "PATCH", body: JSON.stringify({ titulo: titulo.trim(), descripcion, alcance }) });
      onListo();
    } catch (e: any) { setError(e.message); }
    setOcupado(null);
  };
  const reemplazar = async (f: File | undefined) => {
    if (!f) return;
    setOcupado("archivo");
    setError(null);
    const fd = new FormData();
    fd.append("archivo", f);
    try {
      await apiFetch(`${DOCS}/${doc.id}/archivo`, { method: "POST", body: fd });
      onListo();
    } catch (e: any) { setError(e.message); }
    setOcupado(null);
  };
  const valido = titulo.trim().length > 0 && (alcance.tipo !== "permisos" || alcance.permisos.length > 0);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30 animate-fade" onClick={() => !ocupado && onCerrar()}>
      <div className="h-full w-full max-w-xl bg-white shadow-elevated flex flex-col animate-pop" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Editar documento">
        <div className="px-5 py-4 border-b border-brand-border flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-display text-xl text-brand-ink truncate">{doc.titulo}</div>
            <div className="text-xs text-brand-slate">{doc.archivo} · {peso(doc.bytes)}</div>
          </div>
          <button type="button" onClick={onCerrar} className="p-2 rounded-lg text-brand-slate hover:bg-brand-bg" aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <label className="block">
            <span className="label">Título</span>
            <input className="input" value={titulo} maxLength={200} onChange={(e) => setTitulo(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Qué contiene</span>
            <textarea className="input min-h-[80px]" value={descripcion} maxLength={2000} onChange={(e) => setDescripcion(e.target.value)} />
          </label>
          <EditorAlcance valor={alcance} onChange={setAlcance} permisos={permisos} />
          <div className="rounded-xl border border-brand-border p-3.5">
            <div className="text-sm font-semibold text-brand-ink">Versión nueva del archivo</div>
            <p className="text-xs text-brand-slate mt-0.5">Conserva título, descripción y alcance. Las citas de conversaciones anteriores dejan de abrir.</p>
            <input ref={archivo} type="file" accept={ACEPTA} className="hidden" onChange={(e) => reemplazar(e.target.files?.[0])} />
            <button className="btn-secondary text-sm mt-2.5" onClick={() => archivo.current?.click()} disabled={!!ocupado}>
              {ocupado === "archivo" ? <><Loader2 size={15} className="animate-spin" /> Leyendo…</> : <><RefreshCw size={15} /> Reemplazar archivo</>}
            </button>
          </div>
          {error && <p className="text-sm text-brand-primary">{error}</p>}
        </div>
        <div className="px-5 py-3 border-t border-brand-border flex justify-end gap-2">
          <button className="btn-secondary text-sm" onClick={onCerrar} disabled={!!ocupado}>Cancelar</button>
          <button className="btn-primary text-sm" onClick={guardar} disabled={!valido || !!ocupado}>
            {ocupado === "guardar" ? <Loader2 size={15} className="animate-spin" /> : null} Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

function TextoExtraido({ doc, onCerrar }: { doc: DocumentoVoi; onCerrar: () => void }) {
  const [items, setItems] = useState<Fragmento[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(async (desde: number) => {
    setCargando(true);
    try {
      const r = await apiFetch<{ total: number; items: Fragmento[] }>(`${DOCS}/${doc.id}/fragmentos?desde=${desde}&limite=40`);
      setItems((prev) => (desde ? [...prev, ...r.items] : r.items));
      setTotal(r.total);
    } catch (e: any) { setError(e.message); }
    setCargando(false);
  }, [doc.id]);
  useEffect(() => { cargar(0); }, [cargar]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [onCerrar]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30 animate-fade" onClick={onCerrar}>
      <div className="h-full w-full max-w-2xl bg-white shadow-elevated flex flex-col animate-pop" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Texto que lee Voi">
        <div className="px-5 py-4 border-b border-brand-border flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wider2 text-brand-slate font-semibold">Lo que lee Voi</div>
            <div className="font-display text-xl text-brand-ink truncate">{doc.titulo}</div>
            <div className="text-xs text-brand-slate">{num(total)} fragmentos{doc.paginas ? ` · ${doc.paginas} páginas` : ""} · {num(doc.caracteres)} caracteres</div>
          </div>
          <button type="button" onClick={onCerrar} className="p-2 rounded-lg text-brand-slate hover:bg-brand-bg" aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {error && <p className="text-sm text-brand-primary">{error}</p>}
          {items.map((f) => (
            <article key={f.id} className="rounded-xl border border-brand-border p-3.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-brand-slate">
                <span className="font-semibold text-brand-ink">#{f.orden + 1}</span>
                {f.pagina && <span>Página {f.pagina}</span>}
                {f.seccion && <span className="truncate">· {f.seccion}</span>}
              </div>
              <p className="mt-1.5 text-sm text-brand-graphite whitespace-pre-wrap leading-relaxed">{f.texto}</p>
            </article>
          ))}
          {cargando && <div className="text-sm text-brand-mist flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Cargando…</div>}
          {!cargando && items.length < total && (
            <button className="btn-secondary text-sm w-full" onClick={() => cargar(items.length)}>Ver más ({num(total - items.length)} restantes)</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Probar() {
  const [q, setQ] = useState("");
  const [r, setR] = useState<{ terminos: string[]; items: Resultado[] } | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buscar = async () => {
    if (q.trim().length < 2) return;
    setCargando(true);
    setError(null);
    try { setR(await apiFetch(`${DOCS}/buscar`, { method: "POST", body: JSON.stringify({ consulta: q.trim() }) })); }
    catch (e: any) { setError(e.message); }
    setCargando(false);
  };
  return (
    <section className="card p-5">
      <h3 className="font-display text-lg text-brand-ink uppercase flex items-center gap-2"><Search size={16} className="text-brand-primary" /> Probá qué encontraría Voi</h3>
      <p className="text-xs text-brand-slate mt-0.5">La misma búsqueda que usa Voi, sobre todos los documentos activos.</p>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); buscar(); }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej.: plazo del chargeback" />
        <button className="btn-primary text-sm shrink-0" disabled={cargando || q.trim().length < 2}>
          {cargando ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} <span className="hidden sm:inline">Buscar</span>
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-brand-primary">{error}</p>}
      {r && (
        <div className="mt-3">
          <p className="text-[11px] text-brand-mist">Palabras clave: {r.terminos.join(" · ") || "—"}</p>
          <ul className="mt-2 space-y-2">
            {r.items.map((x, i) => (
              <li key={x.fragmento_id} className="rounded-xl border border-brand-border p-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-brand-slate">
                  <span className="font-semibold text-brand-ink">{i + 1}. {x.documento}</span>
                  {x.pagina && <span>p. {x.pagina}</span>}
                  {x.seccion && <span className="truncate">· {x.seccion}</span>}
                  <span className="ml-auto tabular-nums">{x.terminos_encontrados} términos</span>
                </div>
                <p className="mt-1 text-xs text-brand-graphite leading-relaxed line-clamp-4">{x.texto}</p>
              </li>
            ))}
            {!r.items.length && <li className="text-sm text-brand-mist py-2">Sin resultados: Voi diría que no está en los documentos.</li>}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Base de conocimiento: los documentos que Voi consulta y cita, con su alcance. */
export function TabConocimiento() {
  const [lista, setLista] = useState<ListaDocs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [editando, setEditando] = useState<DocumentoVoi | null>(null);
  const [viendo, setViendo] = useState<DocumentoVoi | null>(null);
  const [borrando, setBorrando] = useState<DocumentoVoi | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cargar = useCallback(() => {
    apiFetch<ListaDocs>(DOCS).then((l) => { setLista(l); setError(null); }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const activar = async (d: DocumentoVoi) => {
    setOcupado(d.id);
    try { await apiFetch(`${DOCS}/${d.id}`, { method: "PATCH", body: JSON.stringify({ activo: !d.activo }) }); cargar(); }
    catch (e: any) { setError(e.message); }
    setOcupado(null);
  };
  const borrar = async () => {
    if (!borrando) return;
    setOcupado(borrando.id);
    try { await apiFetch(`${DOCS}/${borrando.id}`, { method: "DELETE" }); setBorrando(null); cargar(); }
    catch (e: any) { setError(e.message); }
    setOcupado(null);
  };
  const totales = useMemo(() => {
    const items = lista?.items ?? [];
    return { activos: items.filter((d) => d.activo).length, fragmentos: items.reduce((s, d) => s + d.fragmentos, 0) };
  }, [lista]);

  if (!lista) {
    return error ? <p className="text-sm text-brand-primary">{error}</p> :
      <div className="text-sm text-brand-mist flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Cargando…</div>;
  }

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl text-brand-ink uppercase flex items-center gap-2"><BookOpen size={18} className="text-brand-primary" /> Base de conocimiento</h2>
            <p className="text-xs text-brand-slate mt-1 max-w-2xl leading-snug">
              Documentos que Voi consulta y cita al responder: manuales, políticas, procedimientos y criterios. Cada uno tiene su
              alcance; por ejemplo, los criterios de Facturación solo para quien tiene Facturación.
            </p>
            <p className="text-[11px] text-brand-mist mt-1">{num(lista.items.length)} documentos · {num(totales.activos)} activos · {num(totales.fragmentos)} fragmentos</p>
          </div>
          {!subiendo && <button className="btn-primary text-sm shrink-0" onClick={() => setSubiendo(true)}><Upload size={15} /> Subir documento</button>}
        </div>
      </section>

      {subiendo && <Subir lista={lista} onCerrar={() => setSubiendo(false)} onListo={() => { setSubiendo(false); cargar(); }} />}
      {error && <div className="rounded-lg border border-brand-primary/30 bg-brand-primary-light px-4 py-3 text-sm text-brand-primary-dark">{error}</div>}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
        <section className="card overflow-hidden">
          {!lista.items.length ? (
            <div className="px-5 py-12 text-center">
              <FileText size={28} className="mx-auto text-brand-mist" />
              <p className="mt-2 text-sm font-semibold text-brand-ink">Todavía no hay documentos</p>
              <p className="text-xs text-brand-slate mt-0.5">Subí el primero: Voi lo va a poder consultar y citar.</p>
            </div>
          ) : (
            <ul className="divide-y divide-brand-border">
              {lista.items.map((d) => (
                <li key={d.id} className={`px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center gap-3 ${d.activo ? "" : "bg-brand-bg-soft"}`}>
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <span className={`grid place-items-center w-10 h-10 rounded-lg text-[10px] font-bold shrink-0 ${d.activo ? "bg-brand-bg text-brand-slate" : "bg-white text-brand-mist border border-brand-border"}`}>{extension(d.archivo)}</span>
                    <div className="min-w-0">
                      <div className={`text-sm font-semibold truncate ${d.activo ? "text-brand-ink" : "text-brand-slate"}`}>{d.titulo}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-brand-slate">
                        <AlcanceBadge a={d.alcance} permisos={lista.permisos} />
                        {!d.activo && <span className="badge-neutral">Inactivo</span>}
                        <span>{d.paginas ? `${d.paginas} págs. · ` : ""}{num(d.fragmentos)} fragmentos · {peso(d.bytes)}</span>
                        <span className="text-brand-mist">· {d.editado_por ?? d.subido_por ?? ""} {cuando(d.updated_at)}</span>
                      </div>
                      {d.descripcion && <p className="text-xs text-brand-slate mt-1 line-clamp-2">{d.descripcion}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 sm:shrink-0 pl-[52px] sm:pl-0">
                    <button type="button" role="switch" aria-checked={d.activo} title={d.activo ? "Activo: Voi lo consulta" : "Inactivo: Voi no lo ve"}
                      onClick={() => activar(d)} disabled={ocupado === d.id}
                      className={`mr-1 w-9 h-5 rounded-full p-0.5 transition-colors ${d.activo ? "bg-emerald-500" : "bg-brand-border"}`}>
                      <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${d.activo ? "translate-x-4" : ""}`} />
                    </button>
                    <button className="btn-ghost px-2" title="Ver el texto que lee Voi" aria-label="Ver texto" onClick={() => setViendo(d)}><Eye size={15} /></button>
                    <button className="btn-ghost px-2" title="Editar" aria-label="Editar" onClick={() => setEditando(d)}><Pencil size={15} /></button>
                    <button className="btn-ghost px-2" title="Descargar" aria-label="Descargar" onClick={() => downloadFile(`${VOI_API}/documentos/${d.id}/archivo`, d.archivo)}><Download size={15} /></button>
                    <button className="btn-ghost px-2 hover:text-brand-primary" title="Borrar" aria-label="Borrar" onClick={() => setBorrando(d)}><Trash2 size={15} /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <Probar />
      </div>

      {editando && <Editar doc={editando} permisos={lista.permisos} onCerrar={() => setEditando(null)} onListo={() => { setEditando(null); cargar(); }} />}
      {viendo && <TextoExtraido doc={viendo} onCerrar={() => setViendo(null)} />}
      <ConfirmDialog open={!!borrando} title="Borrar el documento" variant="danger" confirmLabel="Borrar" loading={!!ocupado}
        message={<>Se borra <b>{borrando?.titulo}</b> y su texto. Voi deja de consultarlo y sus citas en conversaciones anteriores dejan de abrir. Si solo querés que Voi no lo use por ahora, desactivalo.</>}
        onConfirm={borrar} onCancel={() => setBorrando(null)} />
    </div>
  );
}
