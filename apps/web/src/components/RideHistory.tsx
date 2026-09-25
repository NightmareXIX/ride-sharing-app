'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { PAYMENT_METHOD_LABELS, type Booking } from '@/lib/booking';
import { endedAt, rideOutcome, type RidePage } from '@/lib/history';
import { formatTaka } from '@/lib/money';
import { formatDhakaTime } from '@/lib/time';
import { usePagedList } from '@/lib/usePagedList';
import { ListFooter } from './ListFooter';
import { StatusBadge } from './StatusBadge';

const PAGE_SIZE = 20;

// A page of the passenger's past rides; the first page when there is no cursor.
async function readRides(cursor: string | null) {
  const query = `limit=${PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
  const page = await api<RidePage>(`/bookings?${query}`);
  return { items: page.bookings, nextCursor: page.nextCursor };
}

// What the ride cost: its fare, its fine, or nothing.
function charge(booking: Booking): string {
  if (booking.fare) {
    return `${formatTaka(booking.fare.finalFare)} · ${PAYMENT_METHOD_LABELS[booking.paymentMethod]}`;
  }
  if (booking.fine) return `${formatTaka(booking.fine.amount)} fine`;
  return 'No charge';
}

function Ride({ booking }: { booking: Booking }) {
  const outcome = rideOutcome(booking);
  return (
    <li>
      <Link
        href={`/passenger/rides/${booking.id}`}
        className="-mx-2 flex items-start justify-between gap-4 rounded-lg px-2 py-3 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-slate-900"
      >
        <div className="min-w-0">
          <p className="font-medium text-slate-900">
            {booking.pickup.label} → {booking.destination.label}
          </p>
          <p className="mt-0.5 text-sm text-slate-500">{formatDhakaTime(endedAt(booking))}</p>
        </div>
        <div className="shrink-0 text-right">
          <StatusBadge {...outcome} />
          <p className="mt-1 text-sm text-slate-700 tabular-nums">{charge(booking)}</p>
        </div>
      </Link>
    </li>
  );
}

// The passenger's rides that have ended, newest first, a page at a time (FR-P6, NFR-36).
export function RideHistory() {
  const rides = usePagedList(readRides);
  const { showFirst, setError } = rides;

  useEffect(() => {
    let cancelled = false;
    readRides(null).then(
      (page) => {
        if (!cancelled) showFirst(page);
      },
      (err: unknown) => {
        if (!cancelled) setError((err as Error).message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [showFirst, setError]);

  return (
    <section
      aria-labelledby="ride-history-heading"
      className="rounded-xl bg-white p-5 ring-1 ring-slate-200"
    >
      <h2 id="ride-history-heading" className="text-sm font-medium text-slate-500">
        Past rides
      </h2>
      {rides.items === null && !rides.error && (
        <p role="status" className="mt-3 text-slate-500">
          Loading your rides…
        </p>
      )}
      {rides.items?.length === 0 && (
        <p className="mt-3 text-slate-600">
          No past rides yet. Rides you finish or cancel appear here.
        </p>
      )}
      {rides.items && rides.items.length > 0 && (
        <ul className="mt-1 divide-y divide-slate-100">
          {rides.items.map((booking) => (
            <Ride key={booking.id} booking={booking} />
          ))}
        </ul>
      )}
      <ListFooter
        hasMore={rides.hasMore}
        loading={rides.loading}
        error={rides.error}
        onLoadMore={rides.loadMore}
      />
    </section>
  );
}
