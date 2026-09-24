'use client';

import { AppShell, Card } from '@/components/AppShell';
import { formatTaka } from '@/lib/money';
import { useAccount } from '@/lib/useAccount';

export default function PassengerHomePage() {
  const { state, retry } = useAccount('passenger');

  return (
    <AppShell state={state} retry={retry}>
      {state.status === 'ready' && (
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">Hi, {state.account.user.name}</h1>
          <Card label="TeslaPay balance">
            <p className="text-3xl font-semibold tabular-nums">
              {formatTaka(state.account.wallet.balance)}
            </p>
          </Card>
          <p className="rounded-xl border border-dashed border-slate-300 p-5 text-slate-600">
            Booking a ride is coming soon.
          </p>
        </div>
      )}
    </AppShell>
  );
}
