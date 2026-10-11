"use client";

/**
 * Enlaces viejos o mal armados (`/televentas-claro/auditoria/<id o AUD-…>`): llevan al informe en su ruta real,
 * `/televentas-claro/auditoria/informes/<id>`, conservando la pestaña (#evidencia, #hallazgos…).
 */
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppShell } from "@/components/AppShell";

export default function RedireccionInforme() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/televentas-claro/auditoria/informes/${encodeURIComponent(id)}${window.location.hash}`);
  }, [id, router]);
  return (
    <AppShell>
      <div className="card p-10 text-brand-slate">Abriendo el informe…</div>
    </AppShell>
  );
}
