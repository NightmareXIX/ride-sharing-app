'use client';

import { PAYMENT_METHOD_LABELS, RIDE_OPTION_LABELS } from '@/lib/booking';
import { formatTaka } from '@/lib/money';
import { formatDhakaTime } from '@/lib/time';
import type { JoinRule, NearbyRequest } from '@/lib/trip';
import { primaryButton, secondaryButton } from './buttons';

// Open requests the driver can take, oldest first: near an idle Tesla, or on the route of
// one with passengers (FR-L3). The driver picks one; nothing is assigned automatically
// (FR-D8). On a solo ride there are none, and a same-gender trip takes one gender (FR-R10).
export function NearbyRequests({
  requests,
  onTrip,
  joinRule,
  freeSeats,
  accepting,
  onAccept,
  previewing,
  onPreview,
}: {
  requests: NearbyRequest[] | null;
  // The Tesla has passengers, so requests must fit its route.
  onTrip: boolean;
  // Who the trip's ride options let join; `anyone` for an idle Tesla.
  joinRule: JoinRule;
  // Only requests that fit these are listed (FR-D7).
  freeSeats: number;
  // The request being accepted; every Accept button waits for it (NFR-37).
  accepting: string | null;
  onAccept: (request: NearbyRequest) => void;
  // The request whose destination is on the map, one at a time; null for none.
  previewing: string | null;
  onPreview: (requestId: string | null) => void;
}) {
  return (
    <section
      aria-labelledby="nearby-requests-heading"
      className="rounded-xl bg-white p-5 ring-1 ring-slate-200"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="nearby-requests-heading" className="text-lg font-semibold">
          {onTrip ? 'Requests on your route' : 'Nearby requests'}
        </h2>
        <p className="text-sm text-slate-500 tabular-nums">
          {freeSeats} {freeSeats === 1 ? 'seat' : 'seats'} free
        </p>
      </div>
      {(joinRule === 'women' || joinRule === 'men') && (
        <p className="mt-2 text-sm text-slate-600">Same-gender trip: only {joinRule} can join.</p>
      )}
      {joinRule === 'no_one' ? (
        <p className="mt-2 text-slate-600">
          You’re on a solo ride. New requests appear after the drop-off.
        </p>
      ) : requests === null ? (
        <p role="status" className="mt-2 text-slate-500">
          Looking for requests…
        </p>
      ) : requests.length === 0 ? (
        <p className="mt-2 text-slate-600">
          {onTrip
            ? 'No requests fit your route and free seats yet.'
            : 'No requests near your Tesla that fit your free seats yet.'}{' '}
          New ones appear here within a few seconds.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {requests.map((request) => {
            const shown = previewing === request.id;
            return (
              <li
                key={request.id}
                className={`py-4 first:pt-1 last:pb-0 ${shown ? '-mx-3 rounded-lg bg-violet-50 px-3' : ''}`}
              >
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
                    {request.addedKm !== null && (
                      <p className="mt-1 text-sm font-medium text-emerald-700">
                        Adds {request.addedKm} km to your route
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 sm:flex-col sm:items-end">
                    <p className="text-lg font-semibold whitespace-nowrap tabular-nums">
                      {formatTaka(request.estimatedFare)}
                    </p>
                    <div className="flex gap-2 whitespace-nowrap">
                      {/* Only changes the map, so it works while an accept runs. */}
                      <button
                        type="button"
                        aria-pressed={shown}
                        onClick={() => onPreview(shown ? null : request.id)}
                        className={secondaryButton}
                      >
                        {shown ? 'Hide destination' : 'See destination'}
                      </button>
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
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
