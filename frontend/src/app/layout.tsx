import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Operaciones Voicenter · Gerencia Expansión RM",
  description: "Plataforma de la Gerencia Expansión RM — Operada por Voicenter S.A.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
