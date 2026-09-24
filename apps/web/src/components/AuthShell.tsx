import type { ReactNode } from 'react';
import { Wordmark } from './Wordmark';

// Centered card used by the sign-in and sign-up screens; full width on phones (NFR-21).
export function AuthShell({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string;
  subtitle: string;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-8 sm:justify-center">
      <div className="mb-8">
        <Wordmark />
      </div>
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-slate-600">{subtitle}</p>
        <div className="mt-6">{children}</div>
      </div>
      <p className="mt-6 text-center text-sm text-slate-600">{footer}</p>
    </main>
  );
}
