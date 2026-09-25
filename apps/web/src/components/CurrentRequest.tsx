import { PAYMENT_METHOD_LABELS, RIDE_OPTION_LABELS, type Booking } from '@/lib/booking';
import { formatTaka } from '@/lib/money';

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-900">{children}</dd>
    </div>
  );
}

// The passenger's active request. It shows only their own booking (FR-P8).
export function CurrentRequest({ booking }: { booking: Booking }) {
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
    </section>
  );
}
