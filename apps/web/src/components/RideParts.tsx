import type { ReactNode } from 'react';
import type { Booking } from '@/lib/booking';
import { formatTaka } from '@/lib/money';

// Pieces of a passenger's ride, shared by the ride in progress and the ride history.

export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-900">{children}</dd>
    </div>
  );
}

export function Route({ booking }: { booking: Pick<Booking, 'pickup' | 'destination'> }) {
  return (
    <ol className="mt-4 space-y-2">
      <li className="flex items-center gap-3">
        <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-emerald-600" />
        <span>
          <span className="sr-only">Pickup: </span>
          {booking.pickup.label}
        </span>
      </li>
      <li className="flex items-center gap-3">
        <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-red-600" />
        <span>
          <span className="sr-only">Destination: </span>
          {booking.destination.label}
        </span>
      </li>
    </ol>
  );
}

// What a late cancel or a no-show cost the passenger (FR-W6).
export function fineLine(fine: NonNullable<Booking['fine']>): string {
  return fine.reason === 'no_show'
    ? `You were marked as a no-show: a ${formatTaka(fine.amount)} fine was taken from your TeslaPay balance.`
    : `Late-cancel fine: ${formatTaka(fine.amount)} was taken from your TeslaPay balance.`;
}
