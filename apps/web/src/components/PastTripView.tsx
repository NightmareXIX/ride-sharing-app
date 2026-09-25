'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { PAYMENT_METHOD_LABELS, RIDE_OPTION_LABELS } from '@/lib/booking';
import { TRIP_OUTCOMES, type PastTrip, type PastTripBooking } from '@/lib/history';
import { formatTaka } from '@/lib/money';
import { formatDhakaTime } from '@/lib/time';
import { primaryButton } from './buttons';
import { FareBreakdown } from './FareBreakdown';
import { StatusBadge } from './StatusBadge';

function Passenger({ entry }: { entry: PastTripBooking }) {
  return (
    <li className="py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-slate-900">{entry.passenger.name}</p>
          <p className="mt-0.5 text-sm text-slate-600">
            {entry.pickup.label} → {entry.destination.label}
          </p>
          <p className="mt-0.5 text-sm text-slate-500">
            {entry.seats} {entry.seats === 1 ? 'seat' : 'seats'} ·{' '}
            {RIDE_OPTION_LABELS[entry.rideOption]} · {PAYMENT_METHOD_LABELS[entry.paymentMethod]} ·{' '}
            {formatDhakaTime(entry.endedAt)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge {...TRIP_OUTCOMES[entry.outcome]} />
          {entry.penaltyRecorded && <StatusBadge label="Penalty recorded" tone="warn" />}
          {entry.fare && (
            <p className="font-semibold tabular-nums">{formatTaka(entry.fare.finalFare)}</p>
          )}
        </div>
      </div>
      {entry.fare && (
        <details className="mt-3 rounded-lg bg-slate-50 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">
            Fare breakdown
          </summary>
          <div className="mt-2">
            <FareBreakdown fare={entry.fare} />
          </div>
        </details>
      )}
    </li>
  );
}

function TripBody({ trip }: { trip: PastTrip }) {
  const { earnings } = trip;
  return (
    <section
      aria-labelledby="past-trip-heading"
      className="rounded-xl bg-white p-5 ring-1 ring-slate-200"
    >
      <h1 id="past-trip-heading" className="text-lg font-semibold">
        Trip in {trip.vehicle.name}
      </h1>
      <p className="mt-0.5 text-sm text-slate-500">
        {formatDhakaTime(trip.createdAt)}
        {trip.finishedAt && ` to ${formatDhakaTime(trip.finishedAt)}`} (Dhaka time)
      </p>

      <dl className="mt-4 grid grid-cols-3 gap-4 text-sm">
        <div>
          <dt className="text-slate-500">Earned</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{formatTaka(earnings.total)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Cash</dt>
          <dd className="mt-0.5 tabular-nums">{formatTaka(earnings.cash)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">TeslaPay</dt>
          <dd className="mt-0.5 tabular-nums">{formatTaka(earnings.teslapay)}</dd>
        </div>
      </dl>

      <h2 className="mt-6 text-sm font-medium text-slate-500">Passengers</h2>
      <ul className="divide-y divide-slate-100">
        {trip.bookings.map((entry) => (
          <Passenger key={`${entry.id}-${entry.outcome}-${entry.endedAt}`} entry={entry} />
        ))}
      </ul>
    </section>
  );
}

// One of the driver's finished trips with its passengers and fares (FR-D15). Another
// driver's trip, or one still running, is "not found".
export function PastTripView({ id }: { id: string }) {
  const [trip, setTrip] = useState<PastTrip | null>(null);
  const [error, setError] = useState('');
  // A trip that isn't there won't appear on a retry.
  const [missing, setMissing] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<{ pool: PastTrip }>(`/driver/pools/${encodeURIComponent(id)}`).then(
      (body) => {
        if (!cancelled) setTrip(body.pool);
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
  if (!trip) {
    return (
      <p role="status" className="text-slate-500">
        Loading the trip…
      </p>
    );
  }
  return <TripBody trip={trip} />;
}
