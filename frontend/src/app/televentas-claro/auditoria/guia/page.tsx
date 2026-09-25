"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { GuiaAuditor } from "@/components/auditoria/guia/GuiaAuditor";
import { combinarReglas, type ReglasAuditoria } from "@/components/auditoria/guia/datos";
import { AUD_API } from "@/components/auditoria/tipos";
import { apiFetch } from "@/lib/api";

export default function GuiaAuditorPage() {
  return (
    <AppShell>
      <Guia />
    </AppShell>
  );
}

function Guia() {
  const [reglas, setReglas] = useState<ReglasAuditoria | null>(null);
  const [delSistema, setDelSistema] = useState(true);

  useEffect(() => {
    // Las reglas vienen del motor de análisis: la guía muestra exactamente lo que aplica el sistema.
    apiFetch<Partial<ReglasAuditoria>>(`${AUD_API}/parametros`)
      .then((r) => setReglas(combinarReglas(r)))
      .catch(() => {
        setReglas(combinarReglas(null));
        setDelSistema(false);
      });
  }, []);

  if (!reglas) return <div className="card p-10 text-brand-slate">Cargando la guía…</div>;
  return <GuiaAuditor r={reglas} delSistema={delSistema} />;
}
