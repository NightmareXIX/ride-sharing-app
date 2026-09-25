'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormAlert } from '@/components/forms';
import { homePath, type Account } from '@/lib/account';
import { api, ApiError } from '@/lib/api';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, type DemoAccount } from '@/lib/demo';

// One tap signs in as a seeded account, through the same login route as the form.
// Compact shows names only, for under the sign-in form.
export function DemoAccounts({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [alert, setAlert] = useState('');

  async function signIn(demo: DemoAccount) {
    setPending(demo.email);
    setAlert('');
    try {
      const account = await api<Account>('/auth/login', {
        method: 'POST',
        body: { email: demo.email, password: DEMO_PASSWORD },
      });
      router.replace(homePath(account.user.role));
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setAlert(err.message);
      setPending(null);
    }
  }

  // Every button is disabled while one sign-in runs, so a double tap sends it once (NFR-37).
  const disabled = pending !== null;

  return (
    <div className="space-y-3">
      <FormAlert>{alert}</FormAlert>
      {compact ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {DEMO_ACCOUNTS.map((demo) => (
            <button
              key={demo.email}
              type="button"
              disabled={disabled}
              onClick={() => signIn(demo)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-wait disabled:opacity-70"
            >
              {pending === demo.email ? 'Signing in…' : demo.name}
              <span className="block text-xs font-normal text-slate-500 capitalize">
                {demo.role}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {DEMO_ACCOUNTS.map((demo) => (
            <li key={demo.email}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => signIn(demo)}
                className="flex h-full w-full flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-xs transition hover:border-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-wait disabled:opacity-70"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">
                    {pending === demo.email ? 'Signing in…' : demo.name}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                      demo.role === 'driver'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {demo.role}
                  </span>
                </span>
                <span className="text-sm text-slate-600">{demo.blurb}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-slate-500">
        One account per browser: open a private window to play the driver and a passenger at once.
        Every demo account uses the password{' '}
        <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-700">{DEMO_PASSWORD}</code>.
      </p>
    </div>
  );
}
