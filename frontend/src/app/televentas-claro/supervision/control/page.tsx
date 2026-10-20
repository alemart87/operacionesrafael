"use client";

import { AppShell } from "@/components/AppShell";
import { ControlSupervisoresVista } from "@/components/supervision/control";

/** Control de supervisores: qué hace cada supervisor, contado y en vivo (gerente, sub gerente, coordinador, controller). */
export default function ControlPage() {
  return (
    <AppShell>
      <ControlSupervisoresVista />
    </AppShell>
  );
}
