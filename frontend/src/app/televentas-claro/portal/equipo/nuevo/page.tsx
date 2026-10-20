"use client";

import { ArrowLeft, CircleCheck, MessageSquareText, Send, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PortalShell } from "@/components/portal/nav";
import { Boton, Casilla, Fallo, PORTAL, Seccion, useAviso } from "@/components/portal/ui";
import { hrefNuevoCoaching } from "@/components/supervision/hacer-coaching";
import { SUP_API, type OperadorCorto } from "@/components/supervision/tipos";
import { ApiError, apiFetch } from "@/lib/api";

interface Parecido {
  id: string; nombre: string; subcanal: string | null; activo: boolean; equipo: "tuyo" | "otro" | "sin_equipo";
  supervisor: string | null; mismo_documento: boolean; pase_pedido: boolean;
}

export default function AltaAsesorPage() {
  return <PortalShell><Alta /></PortalShell>;
}

function Alta() {
  const [nombre, setNombre] = useState(() => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("nombre") ?? ""));
  const [documento, setDocumento] = useState("");
  const [subcanal, setSubcanal] = useState("");
  const [parecidos, setParecidos] = useState<Parecido[]>([]);
  const [otraPersona, setOtraPersona] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alta, setAlta] = useState<OperadorCorto | null>(null);
  const [pedidos, setPedidos] = useState<Set<string>>(new Set());
  const [aviso, avisar] = useAviso();
  const pedido = useRef(0);

  // Mientras escribe: quién del maestro se parece (para no duplicar personas).
  useEffect(() => {
    const n = nombre.trim();
    const doc = documento.trim();
    if (n.length < 3 && doc.length < 4) { setParecidos([]); return; }
    const k = ++pedido.current;
    const t = setTimeout(async () => {
      try {
        const r = await apiFetch<{ items: Parecido[] }>(`${SUP_API}/portal/asesores/parecidos?nombre=${encodeURIComponent(n)}${doc ? `&documento=${encodeURIComponent(doc)}` : ""}`);
        if (k === pedido.current) { setParecidos(r.items); setOtraPersona(false); }
      } catch { /* la búsqueda es una ayuda: si falla, el servidor vuelve a controlar al guardar */ }
    }, 400);
    return () => clearTimeout(t);
  }, [nombre, documento]);

  const mismoDoc = parecidos.some((p) => p.mismo_documento);
  const palabras = nombre.trim().split(/\s+/).filter((p) => p.length > 1).length;
  const puede = palabras >= 2 && nombre.trim().length >= 5 && !mismoDoc && (!parecidos.length || otraPersona);

  const guardar = async () => {
    setOcupado(true);
    setError(null);
    try {
      const r = await apiFetch<{ operador: OperadorCorto }>(`${SUP_API}/portal/asesores`, {
        method: "POST",
        body: JSON.stringify({ nombre: nombre.trim(), documento: documento.trim() || null, subcanal: subcanal.trim() || null, forzar: otraPersona }),
      });
      setAlta(r.operador);
      window.scrollTo({ top: 0 });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.detail && typeof e.detail === "object") {
        setParecidos(((e.detail as any).parecidos ?? []) as Parecido[]);
        setOtraPersona(false);
      }
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally { setOcupado(false); }
  };
  const pedirPase = async (p: Parecido) => {
    try {
      await apiFetch(`${SUP_API}/portal/asesores/${p.id}/pase`, { method: "POST", body: JSON.stringify({}) });
      setPedidos((s) => new Set(s).add(p.id));
      avisar("Pedido enviado: lo resuelve un jefe.");
    } catch (e: any) { avisar(e.message, "error"); }
  };

  if (alta) {
    return (
      <div className="max-w-xl mx-auto text-center pt-6">
        <span className="mx-auto w-20 h-20 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center"><CircleCheck size={44} aria-hidden /></span>
        <h1 className="font-display text-4xl uppercase text-brand-ink mt-4">Listo</h1>
        <p className="text-[15px] text-brand-slate mt-2"><b className="text-brand-ink">{alta.nombre}</b> ya está en tu equipo desde hoy. Un jefe lo valida y lo vincula con los informes de llamadas y ventas.</p>
        <div className="mt-6 space-y-2 text-left">
          <Boton icono={MessageSquareText} href={hrefNuevoCoaching(alta.id)}>Hacer coaching ahora</Boton>
          <Boton tipo="secundario" icono={Users} href={`${PORTAL}/equipo`}>Volver a mi equipo</Boton>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto">
      <div className="flex items-start gap-1 mb-4">
        <Link href={`${PORTAL}/equipo`} aria-label="Volver a mi equipo" className="w-11 h-11 -ml-2 rounded-full flex items-center justify-center text-brand-ink hover:bg-white shrink-0"><ArrowLeft size={22} aria-hidden /></Link>
        <div className="min-w-0 pt-0.5">
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate">Mi equipo</div>
          <h1 className="font-display text-[34px] uppercase text-brand-ink leading-tight">Agregar asesor</h1>
        </div>
      </div>
      <p className="text-sm text-brand-slate mb-5">Si no lo encontrás en tu equipo, cargalo acá: queda en tu equipo desde hoy y un jefe lo valida.</p>

      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="nombre">Nombre y apellido</label>
          <input id="nombre" className="input !min-h-[52px] !text-base" value={nombre} maxLength={120} autoComplete="off" autoCapitalize="words"
            onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: María Fernanda Gómez" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="doc">Cédula o legajo</label>
            <input id="doc" className="input !min-h-[52px] !text-base" value={documento} maxLength={30} inputMode="numeric"
              onChange={(e) => setDocumento(e.target.value.replace(/[^0-9A-Za-z.\-]/g, ""))} placeholder="Opcional" />
          </div>
          <div>
            <label className="label" htmlFor="sub">Subcanal</label>
            <input id="sub" className="input !min-h-[52px] !text-base uppercase" value={subcanal} maxLength={20}
              onChange={(e) => setSubcanal(e.target.value)} placeholder="Opcional" />
          </div>
        </div>

        {parecidos.length > 0 && (
          <Seccion titulo={mismoDoc ? "Ya está cargado" : "¿Es alguno de estos?"}
            sub={mismoDoc ? "Ya hay un asesor con esa cédula o legajo." : "Se parecen a lo que escribiste. Si es uno de ellos, no lo cargues de nuevo."}>
            <div className="space-y-2">
              {parecidos.map((p) => (
                <div key={p.id} className="card p-4">
                  <div className="font-semibold text-[15px] text-brand-ink">{p.nombre}</div>
                  <div className="text-[13px] text-brand-slate mt-0.5">
                    {p.equipo === "tuyo" ? "Ya está en tu equipo" : p.equipo === "otro" ? `En el equipo de ${p.supervisor ?? "otro supervisor"}` : "Sin equipo"}
                    {!p.activo && " · inactivo"}{p.subcanal && ` · ${p.subcanal}`}{p.mismo_documento && " · misma cédula"}
                  </div>
                  <div className="mt-3">
                    {p.equipo === "tuyo" ? (
                      <Boton tipo="secundario" icono={MessageSquareText} href={hrefNuevoCoaching(p.id)}>Hacerle coaching</Boton>
                    ) : p.pase_pedido || pedidos.has(p.id) ? (
                      <p className="text-sm font-semibold text-emerald-700 flex items-center gap-1.5 min-h-[44px]"><CircleCheck size={16} aria-hidden /> Pase pedido: lo resuelve un jefe</p>
                    ) : (
                      <Boton tipo="secundario" icono={Send} onClick={() => pedirPase(p)}>
                        {p.equipo === "otro" ? "Pedir que lo pasen a mi equipo" : "Pedir que lo asignen a mi equipo"}
                      </Boton>
                    )}
                  </div>
                </div>
              ))}
              {!mismoDoc && (
                <Casilla checked={otraPersona} onChange={setOtraPersona} sub="Se carga como una persona nueva.">
                  Ninguno: es otra persona
                </Casilla>
              )}
            </div>
          </Seccion>
        )}

        {error && <Fallo>{error}</Fallo>}
        <Boton icono={UserPlus} onClick={guardar} disabled={!puede} ocupado={ocupado}>Agregar a mi equipo</Boton>
        {palabras < 2 && nombre.trim().length > 0 && <p className="text-xs text-brand-slate text-center">Escribí nombre y apellido.</p>}
      </div>
      {aviso}
    </div>
  );
}
