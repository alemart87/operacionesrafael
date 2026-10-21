"use client";

import { Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell, useSession } from "@/components/AppShell";
import { HistorialPbi, HojaCargarPbi, TableroPublicado } from "@/components/productividad/pbi";
import { useAviso } from "@/components/portal/ui";

const PERM_PBI = "televentas_claro.productividad_pbi";

/** Productividad · Tablero Power BI: el publicado (como lo ven los supervisores) y, para los publicadores, «Cargar PBI»
 * y lo cargado. */
export default function PbiPage() {
  return (
    <AppShell>
      <Pbi />
    </AppShell>
  );
}

function Pbi() {
  const { can } = useSession();
  const publicador = can(PERM_PBI);
  const [cargar, setCargar] = useState(false);
  const [refresco, setRefresco] = useState(0);
  const [aviso, avisar] = useAviso();
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Asuncion" });
  useEffect(() => {
    if (publicador && new URLSearchParams(window.location.search).get("cargar") === "1") setCargar(true);
  }, [publicador]);
  return (
    <>
      <div className="mb-5 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider2 text-brand-slate mb-2">Productividad</div>
          <h1 className="font-display text-4xl text-brand-ink uppercase leading-tight">Tablero Power BI</h1>
          <p className="text-sm text-brand-slate mt-2 max-w-3xl">
            El tablero del día, como lo ven los supervisores en su portal. {publicador ? "Cargás uno por día: el publicado reemplaza al anterior de ese día." : "Se muestra el último publicado."}
          </p>
        </div>
        {publicador && (
          <button type="button" className="btn-primary" onClick={() => setCargar(true)}><Upload size={16} aria-hidden /> Cargar PBI</button>
        )}
      </div>
      <div className="grid xl:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
        <TableroPublicado refresco={refresco} onCargar={() => setCargar(true)} />
        {publicador && <HistorialPbi refresco={refresco} onCambio={() => setRefresco((k) => k + 1)} />}
      </div>
      {cargar && (
        <HojaCargarPbi hoy={hoy} onClose={() => setCargar(false)} onListo={(t) => {
          setCargar(false);
          setRefresco((k) => k + 1);
          avisar(t.estado === "publicado" ? "Publicado: ya lo ven los supervisores." : "Guardado sin publicar.");
        }} />
      )}
      {aviso}
    </>
  );
}
