'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import type { AccountState } from '@/lib/useAccount';
import { Wordmark } from './Wordmark';

function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // Leave anyway: the sign-in page checks with the server whether a session remains.
    }
    router.replace('/login');
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-slate-900 disabled:opacity-60"
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}

// Layout for signed-in pages, with the loading and error states they share (NFR-22).
export function AppShell({
  state,
  retry,
  children,
}: {
  state: AccountState;
  retry: () => void;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <Wordmark />
          {state.status === 'ready' && <SignOutButton />}
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
        {state.status === 'loading' && (
          <p role="status" className="text-slate-500">
            Loading your account…
          </p>
        )}
        {state.status === 'error' && (
          <div role="alert" className="rounded-xl bg-white p-6 ring-1 ring-slate-200">
            <p className="text-slate-700">{state.message}</p>
            <button
              type="button"
              onClick={retry}
              className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              Try again
            </button>
          </div>
        )}
        {state.status === 'ready' && children}
      </main>
    </div>
  );
}

export function Card({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-5 ring-1 ring-slate-200">
      <h2 className="text-sm font-medium text-slate-500">{label}</h2>
      <div className="mt-1">{children}</div>
    </section>
  );
}
