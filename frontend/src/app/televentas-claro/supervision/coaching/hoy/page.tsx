"use client";

import { AppShell } from "@/components/AppShell";
import { CoachingDelDiaVista } from "@/components/supervision/dia";

/** Coaching del día: cómo van los coaching de hoy de cada supervisor y la revisión del jefe (gerente, sub gerente, coordinador). */
export default function CoachingHoyPage() {
  return (
    <AppShell>
      <CoachingDelDiaVista />
    </AppShell>
  );
}
