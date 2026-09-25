'use client';

import { useRef, useState, type FormEvent } from 'react';
import { api, ApiError, fieldErrors } from '@/lib/api';
import { formatTaka } from '@/lib/money';
import { TOP_UP_PRESETS, type TopUpResult } from '@/lib/wallet';
import { ChoiceGroup, FormAlert, SubmitButton, TextField } from './forms';

// Adds pretend money to the passenger's wallet; there is no payment gateway (FR-W2).
export function TopUpForm({ onToppedUp }: { onToppedUp: (result: TopUpResult) => void }) {
  const [preset, setPreset] = useState<string>(TOP_UP_PRESETS[1]);
  const [custom, setCustom] = useState('');
  const [pending, setPending] = useState(false);
  const [alert, setAlert] = useState('');
  const [amountError, setAmountError] = useState('');
  const [done, setDone] = useState('');
  // A top-up keeps its id until it succeeds, so a retry after a lost reply adds the money
  // once (NFR-37). A different amount is a different top-up, with a new id.
  const attempt = useRef<{ amount: string; id: string } | null>(null);

  const amount = custom.trim() || preset;
  // Shown on the button only while it reads as an amount; the server checks it anyway.
  const readable = /^\d{1,5}(\.\d{1,2})?$/.test(amount);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setAlert('');
    setAmountError('');
    setDone('');
    if (attempt.current?.amount !== amount) {
      attempt.current = { amount, id: crypto.randomUUID() };
    }
    setPending(true);
    try {
      const result = await api<TopUpResult>('/wallet/top-ups', {
        method: 'POST',
        body: { id: attempt.current.id, amount },
      });
      attempt.current = null;
      setCustom('');
      setDone(`Added ${formatTaka(result.transaction.amount)} to your wallet.`);
      onToppedUp(result);
    } catch (err) {
      const fields = err instanceof ApiError ? fieldErrors(err) : {};
      if (fields.amount) setAmountError(fields.amount);
      else setAlert((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <FormAlert>{alert}</FormAlert>
      <ChoiceGroup
        name="preset"
        legend="Amount"
        columns={3}
        value={custom.trim() ? undefined : preset}
        onChange={(next) => {
          setPreset(next);
          setCustom('');
        }}
        options={TOP_UP_PRESETS.map((value) => ({ value, label: formatTaka(value) }))}
      />
      <TextField
        name="amount"
        label="Or another amount"
        inputMode="decimal"
        placeholder="e.g. 250"
        hint="From ৳ 1.00 to ৳ 10,000.00 at a time."
        value={custom}
        onChange={(event) => setCustom(event.target.value)}
        error={amountError}
      />
      {done && (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
          {done}
        </p>
      )}
      <SubmitButton pending={pending}>
        {pending ? 'Topping up…' : readable ? `Top up ${formatTaka(amount)}` : 'Top up'}
      </SubmitButton>
      <p className="text-sm text-slate-500">Pretend money for the demo. No card is charged.</p>
    </form>
  );
}
