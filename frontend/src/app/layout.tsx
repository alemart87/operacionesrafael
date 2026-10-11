import type { Metadata } from "next";
import "./globals.css";
import { VoiProvider } from "@/components/voi/VoiProvider";

export const metadata: Metadata = {
  title: "Operaciones Voicenter · Gerencia Expansión RM",
  description: "Plataforma de la Gerencia Expansión RM — Operada por Voicenter S.A.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        {/* Voi vive en la raíz: el panel sigue abierto mientras se navega. */}
        <VoiProvider>{children}</VoiProvider>
      </body>
    </html>
  );
}
