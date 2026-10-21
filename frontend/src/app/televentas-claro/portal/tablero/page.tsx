"use client";

import { PortalShell } from "@/components/portal/nav";
import { Encabezado } from "@/components/portal/ui";
import { TableroPublicado } from "@/components/productividad/pbi";

/** Portal del supervisor · Tablero: el tablero de Power BI publicado del día. */
export default function TableroPage() {
  return (
    <PortalShell>
      <div className="max-w-5xl mx-auto">
        <Encabezado sobre="Mi portal · Productividad" titulo="Tablero">Los números del día, publicados por la gerencia.</Encabezado>
        <TableroPublicado />
      </div>
    </PortalShell>
  );
}
