'use client';

import { useEffect } from 'react';

export function ResetDialog({
  open,
  onConfirm,
  onClose,
}: {
  open: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="reset-dialog-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg border border-border bg-panel p-6"
      >
        <h2 id="reset-dialog-title" className="text-base font-semibold text-text">
          Reset demo portfolio?
        </h2>
        <p className="mt-2 text-sm text-muted">
          This restores your $100,000 demo balance and clears all holdings and trade
          history. Your watchlist is not affected.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded border border-border px-4 py-2 text-sm text-text hover:bg-panel2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="cursor-pointer rounded bg-down px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Reset demo
          </button>
        </div>
      </div>
    </div>
  );
}
