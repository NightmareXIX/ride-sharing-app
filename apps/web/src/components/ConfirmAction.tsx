'use client';

import { useState, type ReactNode } from 'react';
import { dangerButton, secondaryButton } from './buttons';

// A button that asks once before acting, so a stray tap can't cancel a ride.
export function ConfirmAction({
  label,
  question,
  keepLabel,
  confirmLabel,
  pendingLabel,
  disabled = false,
  onConfirm,
}: {
  label: string;
  question: ReactNode;
  keepLabel: string;
  confirmLabel: string;
  pendingLabel: string;
  disabled?: boolean;
  onConfirm: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={disabled}
        className={secondaryButton}
      >
        {label}
      </button>
    );
  }
  return (
    <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
      <p className="text-sm text-slate-700">{question}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className={secondaryButton}
        >
          {keepLabel}
        </button>
        <button type="button" onClick={confirm} disabled={pending} className={dangerButton}>
          {pending ? pendingLabel : confirmLabel}
        </button>
      </div>
    </div>
  );
}
