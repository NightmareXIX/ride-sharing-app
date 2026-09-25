'use client';

import type { ReactNode } from 'react';
import { PAYMENT_METHOD_LABELS, RIDE_OPTION_LABELS, type PaymentMethod } from '@/lib/booking';
import type { FareBreakdown as Fare } from '@/lib/fare';
import { formatTaka } from '@/lib/money';
import type { DriverTrip, NextAction, TripBooking } from '@/lib/trip';
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

// One passenger in the Tesla: who they are, where they're going and how they pay (FR-D14).
function Passenger({
  booking,
  pending,
  busy,
  onStep,
  onCancel,
}: {
  booking: TripBooking;
  // This passenger's step is running.
  pending: boolean;
  // Some trip action is running; every button waits for it (NFR-37).
  busy: boolean;
  onStep: (booking: TripBooking) => void;
  onCancel: (booking: TripBooking) => Promise<void>;
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
        <button
          type="button"
          onClick={() => onStep(booking)}
          disabled={busy}
          className={primaryButton}
        >
          {pending ? step.pending : step.idle}
        </button>
        {/* Only before pickup; the request goes back to other drivers (FR-D12). */}
        {booking.status !== 'STARTED' && (
          <ConfirmAction
            label="Cancel ride"
            question={`Cancel ${booking.passenger.name}'s ride? Their request goes back to other drivers.`}
            keepLabel="Keep the ride"
            confirmLabel="Yes, cancel it"
            pendingLabel="Cancelling…"
            disabled={busy}
            onConfirm={() => onCancel(booking)}
          />
        )}
      </div>
    </div>
  );
}

// The driver's trip in progress.
export function DriverTripCard({
  trip,
  pendingId,
  onStep,
  onCancel,
}: {
  trip: DriverTrip;
  // The booking whose action is running, if any.
  pendingId: string | null;
  onStep: (booking: TripBooking) => void;
  onCancel: (booking: TripBooking) => Promise<void>;
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
      <div className="divide-y divide-slate-100">
        {trip.bookings.map((booking) => (
          <div key={booking.id} className="py-4 first:pt-0 last:pb-0">
            <Passenger
              booking={booking}
              pending={pendingId === booking.id}
              busy={pendingId !== null}
              onStep={onStep}
              onCancel={onCancel}
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
