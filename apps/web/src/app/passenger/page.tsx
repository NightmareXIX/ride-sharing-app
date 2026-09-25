'use client';

import { useState } from 'react';
import { AppShell, Card } from '@/components/AppShell';
import { CurrentRequest } from '@/components/CurrentRequest';
import { RequestRideForm } from '@/components/RequestRideForm';
import type { Account } from '@/lib/account';
import type { Booking } from '@/lib/booking';
import { formatTaka } from '@/lib/money';
import { useAccount } from '@/lib/useAccount';

function PassengerHome({ account }: { account: Account }) {
  const [booking, setBooking] = useState<Booking | null>(account.currentBooking);

  if (booking) return <CurrentRequest booking={booking} />;
  return (
    <Card label="Where to?">
      <div className="mt-3">
        <RequestRideForm balance={account.wallet.balance} onRequested={setBooking} />
      </div>
    </Card>
  );
}

export default function PassengerHomePage() {
  const { state, retry } = useAccount('passenger');

  return (
    <AppShell state={state} retry={retry}>
      {state.status === 'ready' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Hi, {state.account.user.name}</h1>
            <p className="text-sm text-slate-600">
              TeslaPay{' '}
              <span className="font-semibold tabular-nums text-slate-900">
                {formatTaka(state.account.wallet.balance)}
              </span>
            </p>
          </div>
          <PassengerHome account={state.account} />
        </div>
      )}
    </AppShell>
  );
}
