'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { PAYMENT_METHOD_LABELS, RIDE_OPTION_LABELS, type Booking } from '@/lib/booking';
import { rideOutcome } from '@/lib/history';
import { formatTaka } from '@/lib/money';
import { formatDhakaTime } from '@/lib/time';
import { primaryButton } from './buttons';
import { FareBreakdown } from './FareBreakdown';
import { Detail, fineLine } from './RideParts';
import { StatusBadge } from './StatusBadge';

// The steps the ride went through, with their times in Dhaka.
function timeline(booking: Booking): Array<[string, string]> {
  const steps: Array<[string, string | null]> = [
    ['Requested', booking.requestedAt],
    ['Accepted', booking.acceptedAt],
    ['Driver arrived', booking.arrivedAt],
    ['Picked up', booking.startedAt],
    ['Dropped off', booking.completedAt],
    ['Cancelled', booking.cancelledAt],
  ];
  return steps.flatMap(([label, at]) => (at ? [[label, formatDhakaTime(at)]] : []));
}

function RideBody({ booking }: { booking: Booking }) {
  const ended = booking.status === 'COMPLETED' || booking.status === 'CANCELLED';
  const fare = booking.fare;
  return (
    <section
      aria-labelledby="past-ride-heading"
      className="rounded-xl bg-white p-5 ring-1 ring-slate-200"
    >
      <div className="flex items-start justify-between gap-3">
        <h1 id="past-ride-heading" className="text-lg font-semibold">
          {booking.pickup.label} → {booking.destination.label}
        </h1>
        <StatusBadge {...rideOutcome(booking)} />
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {booking.driver && (
          <Detail label="Driver">
            {booking.driver.name}
            {booking.vehicle && `, ${booking.vehicle.name}`}
          </Detail>
        )}
        <Detail label="Seats">{booking.seats}</Detail>
        <Detail label="Ride option">{RIDE_OPTION_LABELS[booking.rideOption]}</Detail>
        <Detail label="Payment">{PAYMENT_METHOD_LABELS[booking.paymentMethod]}</Detail>
        <Detail label="Estimated fare">
          <span className="tabular-nums">{formatTaka(booking.estimatedFare)}</span>
        </Detail>
      </dl>

      <ol className="mt-5 space-y-1 text-sm">
        {timeline(booking).map(([label, at]) => (
          <li key={label} className="flex justify-between gap-4">
            <span className="text-slate-600">{label}</span>
            <span className="text-slate-900">{at}</span>
          </li>
        ))}
      </ol>
      <p className="mt-1 text-xs text-slate-500">Times are in Dhaka time.</p>

      {!ended && (
        <p className="mt-5 text-sm text-slate-600">
          This ride is still in progress.{' '}
          <Link href="/passenger" className="font-medium text-slate-900 underline">
            Follow it on the Rides screen
          </Link>
          .
        </p>
      )}
      {booking.fine && (
        <p className="mt-5 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          {fineLine(booking.fine)}
        </p>
      )}
      {ended && !fare && !booking.fine && (
        <p className="mt-5 text-sm text-slate-600">This ride was cancelled at no charge.</p>
      )}
      {fare && (
        <div className="mt-5">
          <p className="text-xl font-semibold">
            {formatTaka(fare.finalFare)}{' '}
            {booking.paymentMethod === 'cash' ? 'paid in cash' : 'paid by TeslaPay'}
          </p>
          <div className="mt-4">
            <FareBreakdown fare={fare} />
          </div>
        </div>
      )}
    </section>
  );
}

// One of the passenger's rides with its fare breakdown (FR-P6, FR-P11). Someone else's
// ride is "not found" (FR-P9).
export function PastRide({ id }: { id: string }) {
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState('');
  // A ride that isn't there won't appear on a retry.
  const [missing, setMissing] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<{ booking: Booking }>(`/bookings/${encodeURIComponent(id)}`).then(
      (body) => {
        if (!cancelled) setBooking(body.booking);
      },
      (err: unknown) => {
        if (cancelled) return;
        setMissing(err instanceof ApiError && err.status === 404);
        setError((err as Error).message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  if (error) {
    return (
      <div role="alert" className="rounded-xl bg-white p-6 ring-1 ring-slate-200">
        <p className="text-slate-700">{error}</p>
        {!missing && (
          <button
            type="button"
            onClick={() => {
              setError('');
              setAttempt((n) => n + 1);
            }}
            className={`mt-4 ${primaryButton}`}
          >
            Try again
          </button>
        )}
      </div>
    );
  }
  if (!booking) {
    return (
      <p role="status" className="text-slate-500">
        Loading the ride…
      </p>
    );
  }
  return <RideBody booking={booking} />;
}
