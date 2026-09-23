"use client";

import { useEffect, type ReactNode } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Modal de confirmación con identidad Voicenter. Reemplaza window.confirm. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  variant = "default",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, loading, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-brand-ink/50 backdrop-blur-[2px] animate-fade"
        onClick={() => !loading && onCancel()}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-md card shadow-elevated overflow-hidden animate-pop"
      >
        <div className={`h-1.5 ${variant === "danger" ? "bg-brand-primary" : "bg-brand-cyan"}`} />
        <div className="p-6">
          <h2 className="font-display text-2xl text-brand-ink uppercase leading-tight">{title}</h2>
          {message && (
            <div className="text-sm text-brand-slate mt-2 leading-relaxed">{message}</div>
          )}
          <div className="flex justify-end gap-2 mt-6">
            <button onClick={onCancel} disabled={loading} className="btn-secondary">
              {cancelLabel}
            </button>
            <button onClick={onConfirm} disabled={loading} className="btn-primary">
              {loading ? "Procesando…" : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
