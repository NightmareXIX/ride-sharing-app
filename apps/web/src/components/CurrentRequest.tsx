'use client';

import type { Gender } from '@/lib/account';
import {
  FINE_AMOUNT,
  genderGroup,
  PAYMENT_METHOD_LABELS,
  RIDE_OPTION_LABELS,
  type Booking,
} from '@/lib/booking';
import { formatTaka } from '@/lib/money';
import { isApproximate, usePath } from '@/lib/path';
import { formatDhakaTime } from '@/lib/time';
import { secondaryButton } from './buttons';
import { ConfirmAction } from './ConfirmAction';
import { FareBreakdown } from './FareBreakdown';
import { MapLegend, type LegendItem } from './MapLegend';
import { MapPicker, type MapMarker } from './MapPicker';
import { Detail, fineLine, Route } from './RideParts';

// Where the ride is, in the passenger's words (FR-P5).
function headline(booking: Booking): string {
  const driver = booking.driver?.name ?? 'Your driver';
  switch (booking.status) {
    case 'REQUESTED':
      return booking.notice === 'driver_cancelled'
        ? 'Your driver cancelled. Looking for another driver…'
        : 'Looking for a driver…';
    case 'ACCEPTED':
      return booking.vehicle
        ? `${driver} is on the way in ${booking.vehicle.name}`
        : `${driver} is on the way`;
    case 'DRIVER_ARRIVED':
      return `${driver} has arrived at ${booking.pickup.label}`;
    case 'STARTED':
      return `On the way to ${booking.destination.label}`;
    case 'COMPLETED':
      return `You've arrived at ${booking.destination.label}`;
    case 'CANCELLED':
      return 'This ride was cancelled';
  }
}

function cancelQuestion(booking: Booking): string {
  if (!booking.freeCancelUntil) {
    return 'Cancel this request? It’s free while no driver has accepted it.';
  }
  if (booking.cancelFine) {
    return `Cancel this ride? The free window has passed, so you’ll be fined ${formatTaka(booking.cancelFine)}, even if that takes your balance below zero.`;
  }
  return `Cancel this ride? Cancelling is free until ${formatDhakaTime(booking.freeCancelUntil)}.`;
}

// What the ride option means for this ride (FR-R10). Nothing about anyone else in the
// Tesla (FR-P8).
function optionNote(booking: Booking, gender: Gender): string | null {
  switch (booking.rideOption) {
    case 'solo':
      return booking.status === 'REQUESTED'
        ? 'Solo: waiting for a driver with an empty Tesla.'
        : 'Solo: the Tesla is yours alone.';
    case 'same_gender':
      return `Same-gender: you’ll share only with ${genderGroup(gender)}.`;
    case 'pool':
      return null;
  }
}

// The passenger's own trip on a read-only map: pickup, destination and the road between
// them (route-paths LLD §4). Never the Tesla's route, which passes other riders' stops
// (FR-P8). A straight dashed line stands in until the road arrives.
function RideMap({ booking }: { booking: Booking }) {
  const road = usePath(`/bookings/${booking.id}/path`);
  const markers: MapMarker[] = [
    { key: 'pickup', point: booking.pickup, label: 'Pickup', tone: 'pickup' },
    { key: 'destination', point: booking.destination, label: 'Destination', tone: 'destination' },
  ];
  // Named once the road is in: until then the dashed line only stands in for it.
  const legend: LegendItem[] = !road
    ? []
    : isApproximate(road)
      ? [{ key: 'trip', kind: 'approximate', label: 'Your trip, as a straight line' }]
      : [{ key: 'trip', kind: 'trip', label: 'Your trip by road' }];
  return (
    <div className="mt-5">
      <MapPicker
        label="Map of your trip."
        markers={markers}
        routes={road ? [{ key: 'trip', tone: 'trip', legs: road }] : undefined}
        path={road ? undefined : [booking.pickup, booking.destination]}
      />
      <MapLegend items={legend} />
      {booking.rideOption !== 'solo' && (
        <p className="mt-1 text-sm text-slate-500">
          If you share the Tesla, the ride may detour up to 1 km to pick up or drop off others.
        </p>
      )}
    </div>
  );
}

// The passenger's ride in progress. It shows only their own booking (FR-P8).
export function CurrentRequest({
  booking,
  gender,
  onCancel,
  connectionLost,
}: {
  booking: Booking;
  // The passenger's, for what a Same-gender ride shares with.
  gender: Gender;
  onCancel: () => Promise<void>;
  connectionLost: boolean;
}) {
  const waiting = booking.status === 'REQUESTED';
  // A passenger can cancel until the trip starts (FR-P7).
  const cancellable =
    waiting || booking.status === 'ACCEPTED' || booking.status === 'DRIVER_ARRIVED';
  const note = optionNote(booking, gender);
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
        <h2 id="current-request-heading" className="text-lg font-semibold" aria-live="polite">
          {headline(booking)}
        </h2>
      </div>

      <Route booking={booking} />
      <RideMap booking={booking} />

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
          <span className="font-semibold tabular-nums">{formatTaka(booking.estimatedFare)}</span>
        </Detail>
      </dl>
      <p className="mt-4 text-sm text-slate-500">
        {booking.directKm} km by road
        {booking.distanceMethod === 'fallback' && ' (approximate)'}. You never pay more than the
        estimate.
      </p>
      {note && <p className="mt-1 text-sm text-slate-500">{note}</p>}
      <p className="mt-1 text-sm text-slate-500">
        {booking.acceptedAt
          ? `Accepted ${formatDhakaTime(booking.acceptedAt)}`
          : `Requested ${formatDhakaTime(booking.requestedAt)}`}{' '}
        (Dhaka time)
      </p>
      {booking.freeCancelUntil &&
        cancellable &&
        (booking.cancelFine ? (
          <p className="mt-1 text-sm font-medium text-amber-700">
            Cancelling now costs a {formatTaka(booking.cancelFine)} fine.
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-500">
            Free cancellation until {formatDhakaTime(booking.freeCancelUntil)}, then a{' '}
            {formatTaka(FINE_AMOUNT)} fine
          </p>
        ))}
      {connectionLost && (
        <p role="status" className="mt-3 text-sm text-amber-700">
          Can’t reach the server. Still trying…
        </p>
      )}
      {cancellable && (
        <div className="mt-5">
          <ConfirmAction
            label={waiting ? 'Cancel request' : 'Cancel ride'}
            question={cancelQuestion(booking)}
            keepLabel={waiting ? 'Keep my request' : 'Keep my ride'}
            confirmLabel="Yes, cancel it"
            pendingLabel="Cancelling…"
            onConfirm={onCancel}
          />
        </div>
      )}
    </section>
  );
}

// A ride that has just ended: the fare to pay and how it was worked out (FR-P11), or the
// cancellation.
export function FinishedRide({ booking, onDone }: { booking: Booking; onDone: () => void }) {
  const fare = booking.fare;
  return (
    <section
      aria-labelledby="finished-ride-heading"
      className="rounded-xl bg-white p-5 ring-1 ring-slate-200"
    >
      <h2 id="finished-ride-heading" className="text-lg font-semibold">
        {headline(booking)}
      </h2>
      <Route booking={booking} />
      {booking.fine && (
        <p className="mt-5 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          {fineLine(booking.fine)}
        </p>
      )}
      {fare && (
        <>
          <p className="mt-5 text-xl font-semibold">
            {booking.paymentMethod === 'cash'
              ? `Pay ${formatTaka(fare.finalFare)} in cash${booking.driver ? ` to ${booking.driver.name}` : ''}`
              : `${formatTaka(fare.finalFare)} by TeslaPay`}
          </p>
          <div className="mt-4">
            <FareBreakdown fare={fare} />
          </div>
        </>
      )}
      <button type="button" onClick={onDone} className={`mt-5 ${secondaryButton}`}>
        Request another ride
      </button>
    </section>
  );
}
