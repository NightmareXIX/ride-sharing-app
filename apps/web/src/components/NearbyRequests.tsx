'use client';

import { PAYMENT_METHOD_LABELS, RIDE_OPTION_LABELS } from '@/lib/booking';
import { formatTaka } from '@/lib/money';
import { formatDhakaTime } from '@/lib/time';
import type { NearbyRequest } from '@/lib/trip';
import { primaryButton } from './buttons';

// Open requests near the driver's Tesla, oldest first. The driver picks one; nothing is
// assigned automatically (FR-D8).
export function NearbyRequests({
  requests,
  accepting,
  onAccept,
}: {
  requests: NearbyRequest[] | null;
  // The request being accepted; every Accept button waits for it (NFR-37).
  accepting: string | null;
  onAccept: (request: NearbyRequest) => void;
}) {
  return (
    <section
      aria-labelledby="nearby-requests-heading"
      className="rounded-xl bg-white p-5 ring-1 ring-slate-200"
    >
      <h2 id="nearby-requests-heading" className="text-lg font-semibold">
        Nearby requests
      </h2>
      {requests === null ? (
        <p role="status" className="mt-2 text-slate-500">
          Looking for requests…
        </p>
      ) : requests.length === 0 ? (
        <p className="mt-2 text-slate-600">
          No requests near your Tesla yet. New ones appear here within a few seconds.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {requests.map((request) => (
            <li key={request.id} className="py-4 first:pt-1 last:pb-0">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">
                    {request.pickup.label} → {request.destination.label}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {request.pickupDistanceKm} km from you · {request.seats}{' '}
                    {request.seats === 1 ? 'seat' : 'seats'} ·{' '}
                    {RIDE_OPTION_LABELS[request.rideOption]} ·{' '}
                    {PAYMENT_METHOD_LABELS[request.paymentMethod]}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {request.directKm} km trip · requested {formatDhakaTime(request.requestedAt)}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end">
                  <p className="text-lg font-semibold tabular-nums">
                    {formatTaka(request.estimatedFare)}
                  </p>
                  <button
                    type="button"
                    onClick={() => onAccept(request)}
                    disabled={accepting !== null}
                    className={primaryButton}
                  >
                    {accepting === request.id ? 'Accepting…' : 'Accept'}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
