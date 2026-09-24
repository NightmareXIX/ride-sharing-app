'use client';

import { AppShell, Card } from '@/components/AppShell';
import { formatTaka } from '@/lib/money';
import { useAccount } from '@/lib/useAccount';

export default function DriverHomePage() {
  const { state, retry } = useAccount('driver');

  return (
    <AppShell state={state} retry={retry}>
      {state.status === 'ready' && (
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">Hi, {state.account.user.name}</h1>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card label="Your Tesla">
              {state.account.vehicle ? (
                <>
                  <p className="text-3xl font-semibold">{state.account.vehicle.name}</p>
                  <p className="mt-1 text-slate-600">
                    {state.account.vehicle.capacity} passenger{' '}
                    {state.account.vehicle.capacity === 1 ? 'seat' : 'seats'}
                  </p>
                </>
              ) : (
                <p className="text-slate-600">No Tesla registered.</p>
              )}
            </Card>
            <Card label="TeslaPay balance">
              <p className="text-3xl font-semibold tabular-nums">
                {formatTaka(state.account.wallet.balance)}
              </p>
            </Card>
          </div>
          <p className="rounded-xl border border-dashed border-slate-300 p-5 text-slate-600">
            Going online to take ride requests is coming soon.
          </p>
        </div>
      )}
    </AppShell>
  );
}
