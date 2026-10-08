"use client";

import { Link2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { fechaHora, n } from "@/components/productividad/tipos";
import { SPH_API, SPH_HREF, type Vinculo } from "@/components/sph/tipos";
import { apiFetch } from "@/lib/api";

export default function VinculosPage() {
  return (
    <AppShell>
      <Vinculos />
    </AppShell>
  );
}

/** Vínculos manuales agente → vendedor: los que gestión corrigió a mano. Mandan sobre el cruce por nombre. */
function Vinculos() {
  const [items, setItems] = useState<Vinculo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aQuitar, setAQuitar] = useState<Vinculo | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const load = useCallback(async () => {
    try { setItems((await apiFetch<{ items: Vinculo[] }>(`${SPH_API}/vinculos`)).items); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const quitar = async () => {
    if (!aQuitar) return;
    setOcupado(true);
    try {
      await apiFetch(`${SPH_API}/vinculos`, { method: "PUT", body: JSON.stringify({ clave: aQuitar.clave, nombre: aQuitar.nombre, accion: "automatico" }) });
      setAQuitar(null);
      await load();
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  };

  return (
    <>
      <div className="mb-6">
        <Link href={SPH_HREF} className="text-xs text-brand-slate hover:text-brand-primary">← SPH estimado</Link>
        <h1 className="font-display text-3xl text-brand-ink uppercase mt-1">Vínculos de nombres</h1>
        <p className="text-sm text-brand-slate mt-1 max-w-3xl">
          Los agentes que gestión vinculó a mano con un vendedor de Ventas Netas (o marcó como «no es ninguno»). Mandan sobre el cruce
          automático en los próximos cálculos; los SPH ya calculados no cambian hasta que los recalcules. Se corrigen desde el informe del día.
        </p>
      </div>

      {error && <div className="card p-4 text-brand-primary mb-4">{error}</div>}

      {!items ? (
        <div className="card p-10 text-brand-slate">Cargando…</div>
      ) : !items.length ? (
        <div className="card p-12 text-center">
          <Link2 size={28} className="mx-auto text-brand-mist" />
          <p className="text-brand-slate mt-3 max-w-lg mx-auto">Todavía no hay vínculos manuales: todos los agentes se cruzan por nombre. Para corregir uno, abrí el SPH de un día y usá «Vincular» o «Revisar».</p>
        </div>
      ) : (
        <section className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider2 text-brand-slate border-b border-brand-border">
                  <th className="px-5 py-2.5">Agente (plataforma)</th>
                  <th className="px-3 py-2.5">Vendedor (Ventas Netas)</th>
                  <th className="px-3 py-2.5">Actualizado</th>
                  <th className="px-5 py-2.5 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {items.map((v) => (
                  <tr key={v.clave} className="border-b border-brand-border/60 hover:bg-brand-bg/50">
                    <td className="px-5 py-2.5 font-semibold text-brand-ink">{v.nombre}</td>
                    <td className="px-3 py-2.5">{v.vendedor ?? <span className="text-brand-slate italic">No es ninguno de la lista</span>}</td>
                    <td className="px-3 py-2.5 text-xs text-brand-slate">{v.updated_by ?? "—"} · {fechaHora(v.updated_at)}</td>
                    <td className="px-5 py-2.5 text-right">
                      <button type="button" disabled={ocupado} onClick={() => setAQuitar(v)} className="text-xs font-semibold text-brand-slate hover:text-brand-primary">Volver al cruce automático</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-3 text-[11px] text-brand-mist border-t border-brand-border">{n(items.length)} vínculo(s) manual(es). Cada cambio queda en auditoría.</p>
        </section>
      )}

      <ConfirmDialog
        open={!!aQuitar}
        title="Volver al cruce automático"
        confirmLabel="Quitar vínculo"
        loading={ocupado}
        message={aQuitar && <>Se borra el vínculo manual de <b>{aQuitar.nombre}</b>. En los próximos cálculos el sistema lo vuelve a buscar por nombre.</>}
        onCancel={() => setAQuitar(null)}
        onConfirm={quitar}
      />
    </>
  );
}
