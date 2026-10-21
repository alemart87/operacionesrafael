"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell, useSession } from "@/components/AppShell";
import { CAP_API, CAP_HREF, type Resumen } from "@/components/capacitacion/tipos";
import { Cargando, Fallo } from "@/components/portal/ui";
import { apiFetch } from "@/lib/api";

export default function EnCursoPage() {
  return (
    <AppShell>
      <EnCurso />
    </AppShell>
  );
}

/**
 * «Mi grupo» de la barra inferior: abre directo el grupo en curso (el más reciente). El mentor llega a los que están en
 * piso, que son los suyos. Sin grupo en curso, la lista de grupos.
 */
function EnCurso() {
  const router = useRouter();
  const { user } = useSession();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiFetch<Resumen>(`${CAP_API}/resumen?estado=en_curso`)
      .then((r) => {
        const g = r.grupos[0];
        if (!g) { router.replace(CAP_HREF); return; }
        router.replace(`${CAP_HREF}/grupos/${g.id}${user.role === "mentor" ? "?f=piso" : ""}`);
      })
      .catch((e) => setError(e.message));
  }, [router, user.role]);
  return error ? <Fallo>{error}</Fallo> : <Cargando filas={3} />;
}
