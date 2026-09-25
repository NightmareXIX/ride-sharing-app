'use client';

import type { ReactNode } from 'react';
import { PAYMENT_METHOD_LABELS, RIDE_OPTION_LABELS } from '@/lib/booking';
import { formatTaka } from '@/lib/money';
import type { DriverTrip, TripBooking } from '@/lib/trip';

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

// One passenger in the Tesla: who they are, where they're going and how they pay (FR-D14).
function Passenger({ booking }: { booking: TripBooking }) {
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
    </div>
  );
}

// The driver's trip in progress.
export function DriverTripCard({ trip }: { trip: DriverTrip }) {
  return (
    <section
      aria-label="Your current ride"
      className="rounded-xl bg-white p-5 ring-1 ring-slate-200"
    >
      <div className="divide-y divide-slate-100">
        {trip.bookings.map((booking) => (
          <div key={booking.id} className="py-4 first:pt-0 last:pb-0">
            <Passenger booking={booking} />
          </div>
        ))}
      </div>
    </section>
  );
}
