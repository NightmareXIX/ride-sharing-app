'use client';

import { useState, type ReactNode } from 'react';
import { PAYMENT_METHOD_LABELS, RIDE_OPTION_LABELS, type Booking } from '@/lib/booking';
import { formatTaka } from '@/lib/money';
import { formatDhakaTime } from '@/lib/time';

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-900">{children}</dd>
    </div>
  );
}

const secondaryButton =
  'rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-wait disabled:opacity-70';
const dangerButton =
  'rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:cursor-wait disabled:opacity-70';

// Asks once before cancelling, so a stray tap can't drop the request.
function CancelRequest({ onCancel }: { onCancel: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  async function cancel() {
    setPending(true);
    try {
      await onCancel();
    } finally {
      setPending(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className={secondaryButton}>
        Cancel request
      </button>
    );
  }
  return (
    <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
      <p className="text-sm text-slate-700">
        Cancel this request? It’s free while no driver has accepted it.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className={secondaryButton}
        >
          Keep my request
        </button>
        <button type="button" onClick={cancel} disabled={pending} className={dangerButton}>
          {pending ? 'Cancelling…' : 'Yes, cancel it'}
        </button>
      </div>
    </div>
  );
}

// The passenger's active request. It shows only their own booking (FR-P8).
export function CurrentRequest({
  booking,
  onCancel,
  connectionLost,
}: {
  booking: Booking;
  onCancel: () => Promise<void>;
  connectionLost: boolean;
}) {
  return (
    <section
      aria-labelledby="current-request-heading"
      className="rounded-xl bg-white p-5 ring-1 ring-slate-200"
    >
      <div className="flex items-center gap-3">
        <span aria-hidden className="relative flex size-3">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:hidden" />
          <span className="relative inline-flex size-3 rounded-full bg-emerald-500" />
        </span>
        <h2 id="current-request-heading" className="text-lg font-semibold">
          Looking for a driver…
        </h2>
      </div>

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

      <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Detail label="Seats">{booking.seats}</Detail>
        <Detail label="Ride option">{RIDE_OPTION_LABELS[booking.rideOption]}</Detail>
        <Detail label="Payment">{PAYMENT_METHOD_LABELS[booking.paymentMethod]}</Detail>
        <Detail label="Estimated fare">
          <span className="font-semibold tabular-nums">{formatTaka(booking.estimatedFare)}</span>
        </Detail>
      </dl>
      <p className="mt-4 text-sm text-slate-500">
        {booking.directKm} km by road
        {booking.distanceMethod === 'fallback' && ' (approximate)'}. You never pay more than the
        estimate.
      </p>
      <p className="mt-1 text-sm text-slate-500">
        Requested {formatDhakaTime(booking.requestedAt)} (Dhaka time)
      </p>
      {connectionLost && (
        <p role="status" className="mt-3 text-sm text-amber-700">
          Can’t reach the server. Still trying…
        </p>
      )}
      <div className="mt-5">
        <CancelRequest onCancel={onCancel} />
      </div>
    </section>
  );
}
