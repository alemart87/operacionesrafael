import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-bg px-6">
      <div className="card p-10 text-center max-w-md">
        <div className="font-display text-6xl text-brand-primary">404</div>
        <h1 className="font-display text-2xl text-brand-ink uppercase mt-2">Página no encontrada</h1>
        <p className="text-sm text-brand-slate mt-2">La ruta que buscás no existe o todavía no está disponible.</p>
        <Link href="/inicio" className="btn-primary mt-6">Volver al inicio</Link>
      </div>
    </div>
  );
}
