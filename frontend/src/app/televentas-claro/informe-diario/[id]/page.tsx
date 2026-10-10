"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell, useSession } from "@/components/AppShell";
import { EditorInforme } from "@/components/informe-diario/editor";
import { ID_API, ID_HREF, type InformeDetalle } from "@/components/informe-diario/tipos";
import { VistaInforme } from "@/components/informe-diario/vista";
import { apiFetch } from "@/lib/api";

/** Un informe diario: el editor mientras es borrador de quien entra; si no, la lectura (con comentarios). */
export default function InformePage() {
  return (
    <AppShell>
      <Informe />
    </AppShell>
  );
}

function Informe() {
  const { id } = useParams<{ id: string }>();
  const { isSuperadmin } = useSession();
  const [d, setD] = useState<InformeDetalle | null>(null);
  const [firmado, setFirmado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setD(null);
    apiFetch<InformeDetalle>(`${ID_API}/${id}`).then(setD).catch((e) => setError(e.message));
  }, [id]);

  const volver = isSuperadmin && d && !d.es_autor
    ? { href: `${ID_HREF}/seguimiento`, label: "Seguimiento de los informes" }
    : { href: ID_HREF, label: "Mis informes" };
  return (
    <>
      <Link href={volver.href} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-slate hover:text-brand-primary mb-4 print:hidden">
        <ArrowLeft size={14} /> {volver.label}
      </Link>
      {error && <div className="card p-4 text-sm text-brand-primary">{error}</div>}
      {!d ? (!error && <div className="card p-10 text-brand-slate">Cargando…</div>)
        : d.puede_editar ? <EditorInforme key={d.id} inicial={d} onFirmado={(x) => { setD(x); setFirmado(true); window.scrollTo({ top: 0 }); }} />
          : <VistaInforme key={`${d.id}-${d.estado}`} inicial={d} superadmin={isSuperadmin} recienFirmado={firmado} />}
    </>
  );
}
