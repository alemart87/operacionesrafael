"use client";

import { AppShell } from "@/components/AppShell";
import { GuiaKnime } from "@/components/integraciones/GuiaKnime";

export default function Page() {
  return (
    <AppShell>
      <GuiaKnime />
    </AppShell>
  );
}
