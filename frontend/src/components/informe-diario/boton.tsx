"use client";

import { ClipboardPenLine, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { ID_API, ID_HREF } from "./tipos";

/**
 * «Preparar informe diario»: abre el borrador del día (o el informe que ya existe) y lleva a él.
 * `fecha`: otro día (hasta 7 días atrás); por defecto, hoy.
 */
export function PrepararInforme({ fecha, className = "btn-primary", children, onError }: {
  fecha?: string; className?: string; children?: ReactNode; onError?: (msg: string) => void;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const abrir = async () => {
    setOcupado(true);
    try {
      const r = await apiFetch<{ id: string }>(ID_API, { method: "POST", body: JSON.stringify(fecha ? { fecha } : {}) });
      router.push(`${ID_HREF}/${r.id}`);
    } catch (e: any) {
      setOcupado(false);
      if (onError) onError(e.message); else alert(e.message);
    }
  };
  return (
    <button type="button" className={className} onClick={abrir} disabled={ocupado}>
      {ocupado ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <ClipboardPenLine size={18} aria-hidden />}
      {children ?? "Preparar informe diario"}
    </button>
  );
}
