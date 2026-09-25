'use client';

import { AppShell } from '@/components/AppShell';
import { RideHistory } from '@/components/RideHistory';
import { useAccount } from '@/lib/useAccount';

export default function PassengerRidesPage() {
  const { state, retry } = useAccount('passenger');

  return (
    <AppShell state={state} retry={retry}>
      {state.status === 'ready' && (
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">History</h1>
          <RideHistory />
        </div>
      )}
    </AppShell>
  );
}
