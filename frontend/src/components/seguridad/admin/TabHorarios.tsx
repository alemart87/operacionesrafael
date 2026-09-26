"use client";

import { CalendarOff, Clock, Copy, Eye, Globe2, Plus, ShieldAlert, ShieldOff, Trash2 } from "lucide-react";
import { useState } from "react";
import { ROLE_LABELS } from "@/lib/api";
import { CampoNumero, Interruptor, type ConfigSeguridad, type RespuestaConfig, Seccion, fechaCorta } from "./comunes";

const MODOS = [
  { k: "desactivado", icono: ShieldOff, titulo: "Desactivado", desc: "Sin restricción horaria. Nadie queda afuera." },
  { k: "registrar", icono: Eye, titulo: "Solo registrar", desc: "Deja entrar, pero anota en la auditoría cada uso fuera de horario. Ideal para medir antes de bloquear." },
  { k: "bloquear", icono: ShieldAlert, titulo: "Bloquear", desc: "Fuera de horario no se puede ingresar y las sesiones abiertas se cierran solas al terminar la franja." },
] as const;

const DIAS_CORTOS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export function TabHorarios({ cfg, set, meta }: {
  cfg: ConfigSeguridad; set: (fn: (c: ConfigSeguridad) => void) => void; meta: RespuestaConfig;
}) {
  const h = cfg.horarios;
  const [feriado, setFeriado] = useState("");

  const franja = (perfil: string, dia: number, i: number, lado: 0 | 1, valor: string) =>
    set((c) => { c.horarios.perfiles[perfil].dias[String(dia)][i][lado] = valor; });
  const agregar = (perfil: string, dia: number) =>
    set((c) => {
      const lista = (c.horarios.perfiles[perfil].dias[String(dia)] ??= []);
      lista.push(lista.length ? ["14:00", "18:00"] : ["08:00", "17:00"]);
    });
  const quitar = (perfil: string, dia: number, i: number) =>
    set((c) => { c.horarios.perfiles[perfil].dias[String(dia)].splice(i, 1); });
  const copiarLunes = (perfil: string) =>
    set((c) => {
      const lunes = c.horarios.perfiles[perfil].dias["0"] ?? [];
      for (const d of ["1", "2", "3", "4"]) c.horarios.perfiles[perfil].dias[d] = lunes.map((f) => [f[0], f[1]] as [string, string]);
    });
  const copiarPerfil = (desde: string, hacia: string) =>
    set((c) => { c.horarios.perfiles[hacia] = JSON.parse(JSON.stringify(c.horarios.perfiles[desde])); });

  return (
    <div className="space-y-5">
      <Seccion icono={<ShieldAlert size={18} />} titulo="Control de horario" descripcion="Cómo se aplican las franjas horarias. El superadmin está siempre exento.">
        <div className="grid md:grid-cols-3 gap-3">
          {MODOS.map(({ k, icono: Icono, titulo, desc }) => {
            const activo = h.modo === k;
            return (
              <button
                key={k} type="button" onClick={() => set((c) => { c.horarios.modo = k; })}
                className={`text-left rounded-lg border-2 p-4 transition-all ${
                  activo
                    ? k === "bloquear" ? "border-brand-primary bg-brand-primary-light/60" : k === "registrar" ? "border-brand-orange bg-brand-orange/5" : "border-brand-ink bg-brand-bg"
                    : "border-brand-border hover:border-brand-mist bg-white"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icono size={18} className={activo ? (k === "bloquear" ? "text-brand-primary" : k === "registrar" ? "text-brand-orange" : "text-brand-ink") : "text-brand-mist"} />
                  <span className="font-display text-lg uppercase text-brand-ink">{titulo}</span>
                  {activo && <span className="ml-auto badge-neutral">Actual</span>}
                </div>
                <p className="text-xs text-brand-slate mt-1.5 leading-relaxed">{desc}</p>
              </button>
            );
          })}
        </div>
        <div className="grid sm:grid-cols-2 gap-4 mt-5">
          <div>
            <label className="label flex items-center gap-1.5"><Globe2 size={12} /> Zona horaria</label>
            <select className="input" value={h.zona} onChange={(e) => set((c) => { c.horarios.zona = e.target.value; })}>
              {["America/Asuncion", "America/Argentina/Buenos_Aires", "America/Sao_Paulo", "America/Montevideo", "America/La_Paz", "UTC"]
                .concat(h.zona && !["America/Asuncion", "America/Argentina/Buenos_Aires", "America/Sao_Paulo", "America/Montevideo", "America/La_Paz", "UTC"].includes(h.zona) ? [h.zona] : [])
                .map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
            </select>
            <p className="text-[11px] text-brand-mist mt-1">Las franjas se interpretan en esta zona.</p>
          </div>
          <CampoNumero
            label="Aviso antes del cierre" sufijo="minutos" min={0} max={60} valor={h.aviso_minutos}
            onChange={(v) => set((c) => { c.horarios.aviso_minutos = v; })}
            ayuda="El usuario ve una cuenta regresiva antes de que termine su franja."
          />
        </div>
      </Seccion>

      <div className="grid xl:grid-cols-2 gap-5">
        {meta.perfiles.map((perfil) => {
          const p = h.perfiles[perfil];
          if (!p) return null;
          const estado = meta.ahora[perfil];
          return (
            <Seccion
              key={perfil}
              icono={<Clock size={18} />}
              titulo={ROLE_LABELS[perfil] ?? perfil}
              descripcion={
                !p.activo ? "Sin restricción para este perfil."
                  : estado?.permitido ? <>Ahora: <span className="text-emerald-700 font-semibold">habilitado</span>{estado.hasta ? ` hasta ${fechaCorta(estado.hasta)}` : ""} (según lo guardado)</>
                  : <>Ahora: <span className="text-brand-primary-dark font-semibold">{estado?.motivo === "feriado" ? "feriado" : "fuera de horario"}</span> (según lo guardado)</>
              }
              accion={
                <Interruptor label="" valor={p.activo} onChange={(v) => set((c) => { c.horarios.perfiles[perfil].activo = v; })} />
              }
            >
              <div className={p.activo ? "" : "opacity-45 pointer-events-none"}>
                <div className="space-y-1.5">
                  {DIAS_CORTOS.map((dNombre, d) => {
                    const lista = p.dias[String(d)] ?? [];
                    return (
                      <div key={d} className="flex items-start gap-3 py-1.5 border-b border-brand-border/70 last:border-0">
                        <div className={`w-11 pt-1.5 text-xs font-bold uppercase tracking-wider2 ${lista.length ? "text-brand-ink" : "text-brand-mist"}`}>{dNombre}</div>
                        <div className="flex-1 flex flex-wrap items-center gap-2 min-h-[34px]">
                          {lista.length === 0 && <span className="text-xs text-brand-mist italic pt-1.5">Sin acceso</span>}
                          {lista.map((f, i) => {
                            const mal = !(f[0] < f[1]);
                            return (
                              <div key={i} className={`flex items-center gap-1 rounded-md border pl-1.5 pr-0.5 py-0.5 bg-white ${mal ? "border-brand-primary" : "border-brand-border"}`}>
                                <input type="time" className="text-xs bg-transparent focus:outline-none w-[104px]" value={f[0]} onChange={(e) => franja(perfil, d, i, 0, e.target.value)} />
                                <span className="text-brand-mist text-xs">–</span>
                                <input type="time" className="text-xs bg-transparent focus:outline-none w-[104px]" value={f[1] === "24:00" ? "23:59" : f[1]} onChange={(e) => franja(perfil, d, i, 1, e.target.value === "23:59" ? "24:00" : e.target.value)} />
                                <button type="button" onClick={() => quitar(perfil, d, i)} className="p-1 text-brand-mist hover:text-brand-primary" aria-label="Quitar franja"><Trash2 size={12} /></button>
                              </div>
                            );
                          })}
                          {lista.length < 4 && (
                            <button type="button" onClick={() => agregar(perfil, d)} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-brand-slate hover:text-brand-primary hover:bg-brand-primary-light">
                              <Plus size={12} /> Franja
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <button type="button" className="btn-ghost text-xs" onClick={() => copiarLunes(perfil)}><Copy size={13} /> Copiar lunes a martes–viernes</button>
                  <select
                    className="text-xs border border-brand-border rounded-md px-2 py-1.5 bg-white text-brand-slate"
                    value="" onChange={(e) => e.target.value && copiarPerfil(e.target.value, perfil)}
                  >
                    <option value="">Copiar horario de…</option>
                    {meta.perfiles.filter((o) => o !== perfil).map((o) => <option key={o} value={o}>{ROLE_LABELS[o] ?? o}</option>)}
                  </select>
                </div>
              </div>
            </Seccion>
          );
        })}
      </div>

      <Seccion icono={<CalendarOff size={18} />} titulo="Feriados" descripcion="Días sin acceso para los perfiles con horario (salvo quien tenga una excepción vigente).">
        <div className="flex flex-wrap items-end gap-2 mb-4">
          <div>
            <label className="label">Agregar feriado</label>
            <input type="date" className="input w-auto" value={feriado} onChange={(e) => setFeriado(e.target.value)} />
          </div>
          <button
            className="btn-secondary" disabled={!feriado || h.feriados.includes(feriado)}
            onClick={() => { set((c) => { c.horarios.feriados = [...c.horarios.feriados, feriado].sort(); }); setFeriado(""); }}
          >
            <Plus size={15} /> Agregar
          </button>
        </div>
        {h.feriados.length === 0 ? (
          <p className="text-sm text-brand-slate">No hay feriados cargados.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {h.feriados.map((f) => {
              const d = new Date(`${f}T12:00:00`);
              const pasado = f < new Date().toISOString().slice(0, 10);
              return (
                <span key={f} className={`inline-flex items-center gap-2 pl-3 pr-1 py-1 rounded-full border text-xs font-semibold ${pasado ? "border-brand-border text-brand-mist" : "border-brand-cyan/30 bg-brand-cyan/5 text-brand-graphite"}`}>
                  {d.toLocaleDateString("es-PY", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
                  <button type="button" className="p-1 rounded-full hover:bg-brand-primary-light hover:text-brand-primary" aria-label="Quitar feriado"
                    onClick={() => set((c) => { c.horarios.feriados = c.horarios.feriados.filter((x) => x !== f); })}>
                    <Trash2 size={11} />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </Seccion>
    </div>
  );
}
