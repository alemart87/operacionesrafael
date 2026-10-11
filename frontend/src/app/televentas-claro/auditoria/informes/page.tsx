"use client";

/** `/televentas-claro/auditoria/informes` no es una pantalla: la lista de informes está en `/televentas-claro/auditoria`. */
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function ListaInformes() {
  const router = useRouter();
  useEffect(() => { router.replace("/televentas-claro/auditoria"); }, [router]);
  return null;
}
