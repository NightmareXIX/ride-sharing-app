'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { PastRide } from '@/components/PastRide';
import { useAccount } from '@/lib/useAccount';

export default function PassengerRidePage() {
  const { state, retry } = useAccount('passenger');
  const { id } = useParams<{ id: string }>();

  return (
    <AppShell state={state} retry={retry}>
      {state.status === 'ready' && (
        <div className="space-y-4">
          <Link
            href="/passenger/rides"
            className="inline-block rounded-lg text-sm text-slate-600 hover:underline focus-visible:outline-2 focus-visible:outline-slate-900"
          >
            ← All rides
          </Link>
          <PastRide id={id} />
        </div>
      )}
    </AppShell>
  );
}
