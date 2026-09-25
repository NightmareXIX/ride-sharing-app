'use client';

import { AppShell } from '@/components/AppShell';
import { DriverHistory } from '@/components/DriverHistory';
import { useAccount } from '@/lib/useAccount';

export default function DriverTripsPage() {
  const { state, retry } = useAccount('driver');

  return (
    <AppShell state={state} retry={retry}>
      {state.status === 'ready' && (
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">History</h1>
          <DriverHistory />
        </div>
      )}
    </AppShell>
  );
}
