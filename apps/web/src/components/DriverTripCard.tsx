'use client';

import type { ReactNode } from 'react';
import {
  FINE_AMOUNT,
  PAYMENT_METHOD_LABELS,
  RIDE_OPTION_LABELS,
  type PaymentMethod,
} from '@/lib/booking';
import type { FareBreakdown as Fare } from '@/lib/fare';
import { formatTaka } from '@/lib/money';
import { formatDhakaTime } from '@/lib/time';
import type { DriverTrip, NextAction, TripBooking, TripStop } from '@/lib/trip';
import { primaryButton, secondaryButton } from './buttons';
import { ConfirmAction } from './ConfirmAction';
import { FareBreakdown } from './FareBreakdown';

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-900">{children}</dd>
    </div>
  );
}

function headline(booking: TripBooking): string {
  const name = booking.passenger.name;
  switch (booking.status) {
    case 'ACCEPTED':
      return `Pick up ${name} at ${booking.pickup.label}`;
    case 'DRIVER_ARRIVED':
      return `Waiting for ${name} at ${booking.pickup.label}`;
    case 'STARTED':
      return `Taking ${name} to ${booking.destination.label}`;
  }
}

// The one step the driver can take next, and its label while it runs (FR-D10).
const STEP_LABELS: Record<NextAction, { idle: string; pending: string }> = {
  arrive: { idle: 'Arrived at pickup', pending: 'Saving…' },
  start: { idle: 'Passenger is in, start trip', pending: 'Starting…' },
  complete: { idle: 'Dropped off, complete trip', pending: 'Completing…' },
};

// The stops in the order the driver takes them, with the km along the trip at each: the
// reading once reached, else the plan (FR-L5). Only the next stop can be acted on.
function RouteStops({ stops }: { stops: TripStop[] }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-slate-500">Route</h3>
      <ol className="mt-2 space-y-1">
        {stops.map((stop) => {
          const reached = stop.actualOdometerKm !== null;
          return (
            <li
              key={stop.id}
              aria-current={stop.isNext ? 'step' : undefined}
              className={`flex items-baseline justify-between gap-3 rounded-lg px-3 py-2 text-sm ${
                stop.isNext ? 'bg-emerald-50 ring-1 ring-emerald-200' : ''
              }`}
            >
              <span className="flex min-w-0 items-baseline gap-2.5">
                <span
                  aria-hidden
                  className={`size-2.5 shrink-0 rounded-full ${
                    stop.type === 'pickup' ? 'bg-emerald-600' : 'bg-red-600'
                  } ${reached ? 'opacity-40' : ''}`}
                />
                <span className={reached ? 'text-slate-500' : 'text-slate-900'}>
                  {stop.type === 'pickup' ? 'Pick up' : 'Drop off'} {stop.passenger.name} at{' '}
                  {stop.place.label}
                </span>
              </span>
              <span className="shrink-0 text-right tabular-nums text-slate-500">
                {stop.isNext && <span className="mr-2 font-medium text-emerald-700">Next</span>}
                {reached ? (
                  <>
                    <span aria-hidden>✓ </span>
                    <span className="sr-only">Reached at </span>
                    {stop.actualOdometerKm} km
                  </>
                ) : (
                  <>
                    <span className="sr-only">Planned at </span>
                    {stop.plannedOdometerKm} km
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// A driver cancel before pickup is free for 3 minutes after accepting; later it records a
// penalty against the driver (FR-D13).
function cancelQuestion(booking: TripBooking): string {
  const name = booking.passenger.name;
  if (booking.cancelRecordsPenalty) {
    return `Cancel ${name}'s ride? You accepted it more than 3 minutes ago, so this records a penalty against you. Their request goes back to other drivers.`;
  }
  return `Cancel ${name}'s ride? Their request goes back to other drivers. From ${formatDhakaTime(booking.penaltyFrom)}, cancelling records a penalty against you.`;
}

// One passenger in the Tesla: who they are, where they're going and how they pay (FR-D14).
function Passenger({
  booking,
  pending,
  busy,
  onStep,
  onCancel,
  onNoShow,
}: {
  booking: TripBooking;
  // This passenger's step is running.
  pending: boolean;
  // Some trip action is running; every button waits for it (NFR-37).
  busy: boolean;
  onStep: (booking: TripBooking) => void;
  onCancel: (booking: TripBooking) => Promise<void>;
  onNoShow: (booking: TripBooking) => Promise<void>;
}) {
  const step = STEP_LABELS[booking.nextAction];
  return (
    <div>
      <h3 className="text-lg font-semibold">{headline(booking)}</h3>
      <ol className="mt-3 space-y-2">
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
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Detail label="Passenger">{booking.passenger.name}</Detail>
        <Detail label="Seats">{booking.seats}</Detail>
        <Detail label="Payment">
          {PAYMENT_METHOD_LABELS[booking.paymentMethod]}, {RIDE_OPTION_LABELS[booking.rideOption]}
        </Detail>
        <Detail label="Estimate">
          <span className="font-semibold tabular-nums">{formatTaka(booking.estimatedFare)}</span>
        </Detail>
      </dl>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-start">
        {/* The stops go in order: a step is offered only at the next stop. */}
        {booking.canAct ? (
          <button
            type="button"
            onClick={() => onStep(booking)}
            disabled={busy}
            className={primaryButton}
          >
            {pending ? step.pending : step.idle}
          </button>
        ) : (
          <p className="py-2 text-sm text-slate-500">
            {booking.status === 'STARTED'
              ? 'Aboard. Drop-off comes after the stops before it.'
              : 'Pickup comes after the stops before it.'}
          </p>
        )}
        {/* Only before pickup; the request goes back to other drivers (FR-D12). */}
        {booking.status !== 'STARTED' && (
          <ConfirmAction
            label="Cancel ride"
            question={cancelQuestion(booking)}
            keepLabel="Keep the ride"
            confirmLabel="Yes, cancel it"
            pendingLabel="Cancelling…"
            disabled={busy}
            onConfirm={() => onCancel(booking)}
          />
        )}
        {/* 5 minutes after arriving, a passenger who hasn't come can be let go (FR-D11). */}
        {booking.status === 'DRIVER_ARRIVED' && booking.canNoShow && (
          <ConfirmAction
            label="No-show"
            question={`Mark ${booking.passenger.name} as a no-show? Their ride is cancelled and they're fined ${formatTaka(FINE_AMOUNT)}.`}
            keepLabel="Keep waiting"
            confirmLabel="Yes, mark no-show"
            pendingLabel="Saving…"
            disabled={busy}
            onConfirm={() => onNoShow(booking)}
          />
        )}
      </div>
      {booking.status === 'DRIVER_ARRIVED' && !booking.canNoShow && booking.noShowFrom && (
        <p className="mt-2 text-sm text-slate-500">
          If {booking.passenger.name} doesn’t come, you can mark a no-show from{' '}
          {formatDhakaTime(booking.noShowFrom)}.
        </p>
      )}
    </div>
  );
}

// The driver's trip in progress.
export function DriverTripCard({
  trip,
  pendingId,
  onStep,
  onCancel,
  onNoShow,
}: {
  trip: DriverTrip;
  // The booking whose action is running, if any.
  pendingId: string | null;
  onStep: (booking: TripBooking) => void;
  onCancel: (booking: TripBooking) => Promise<void>;
  onNoShow: (booking: TripBooking) => Promise<void>;
}) {
  return (
    <section
      aria-labelledby="current-trip-heading"
      className="rounded-xl bg-white p-5 ring-1 ring-slate-200"
    >
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 id="current-trip-heading" className="text-sm font-medium text-slate-500">
          In your Tesla
        </h2>
        <p className="text-sm text-slate-500 tabular-nums">
          {trip.bookings.length} {trip.bookings.length === 1 ? 'passenger' : 'passengers'}
        </p>
      </div>
      <div className="mb-4 border-b border-slate-100 pb-4">
        <RouteStops stops={trip.stops} />
      </div>
      <div className="divide-y divide-slate-100">
        {trip.bookings.map((booking) => (
          <div key={booking.id} className="py-4 first:pt-0 last:pb-0">
            <Passenger
              booking={booking}
              pending={pendingId === booking.id}
              busy={pendingId !== null}
              onStep={onStep}
              onCancel={onCancel}
              onNoShow={onNoShow}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

export interface CompletedRide {
  passengerName: string;
  paymentMethod: PaymentMethod;
  fare: Fare;
}

// Shown once a passenger is dropped off: what to collect, and how it was worked out.
export function CompletedRideCard({
  ride,
  onDismiss,
}: {
  ride: CompletedRide;
  onDismiss: () => void;
}) {
  const amount = formatTaka(ride.fare.finalFare);
  return (
    <section
      aria-labelledby="completed-ride-heading"
      className="rounded-xl bg-white p-5 ring-1 ring-slate-200"
    >
      <p className="text-sm font-medium text-emerald-700">Ride complete</p>
      <h2 id="completed-ride-heading" className="mt-1 text-xl font-semibold">
        {ride.paymentMethod === 'cash'
          ? `Collect ${amount} in cash from ${ride.passengerName}`
          : `${ride.passengerName} pays ${amount} by TeslaPay`}
      </h2>
      <div className="mt-4">
        <FareBreakdown fare={ride.fare} />
      </div>
      <button type="button" onClick={onDismiss} className={`mt-5 ${secondaryButton}`}>
        Done
      </button>
    </section>
  );
}
