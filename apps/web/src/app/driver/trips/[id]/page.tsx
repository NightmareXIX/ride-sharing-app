'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { PastTripView } from '@/components/PastTripView';
import { useAccount } from '@/lib/useAccount';

export default function DriverTripPage() {
  const { state, retry } = useAccount('driver');
  const { id } = useParams<{ id: string }>();

  return (
    <AppShell state={state} retry={retry}>
      {state.status === 'ready' && (
        <div className="space-y-4">
          <Link
            href="/driver/trips"
            className="inline-block rounded-lg text-sm text-slate-600 hover:underline focus-visible:outline-2 focus-visible:outline-slate-900"
          >
            ← All trips
          </Link>
          <PastTripView id={id} />
        </div>
      )}
    </AppShell>
  );
}
