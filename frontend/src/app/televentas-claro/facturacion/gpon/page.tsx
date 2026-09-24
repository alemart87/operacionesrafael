"use client";

import { SimuladorAnual } from "@/components/facturacion/SimuladorAnual";

/** Negocio GPON (fibra + TV): el MISMO simulador anual de pospago (setear mes 1, ventas por mes,
 *  meses afectados, bono a mano, registro, historia, cierre, EERR) con el motor y las variables GPON. */
export default function GponPage() {
  return <SimuladorAnual negocio="gpon" />;
}
