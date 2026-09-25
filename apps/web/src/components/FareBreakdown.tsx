import type { ReactNode } from 'react';
import { RIDE_OPTION_LABELS } from '@/lib/booking';
import type { FareBreakdown as Fare } from '@/lib/fare';
import { formatTaka } from '@/lib/money';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-slate-600">{label}</dt>
      <dd className="text-right tabular-nums text-slate-900">{children}</dd>
    </div>
  );
}

// Every step of a completed ride's fare, so it can be checked by hand (FR-F6, FR-P11).
export function FareBreakdown({ fare }: { fare: Fare }) {
  const shared = fare.sharedKm !== '0.000';
  return (
    <div>
      <dl className="divide-y divide-slate-100 text-sm">
        <Row label="Odometer at pickup → drop-off">
          {fare.pickupOdometerKm} → {fare.dropoffOdometerKm} km
        </Row>
        <Row label="Distance travelled">{fare.actualKm} km</Row>
        <Row label="Shared with other passengers">{fare.sharedKm} km</Row>
        <Row label="Base fare">{formatTaka(fare.baseFare)}</Row>
        <Row label="Distance rate">{formatTaka(fare.perKmRate)} per km</Row>
        {shared && (
          <Row label="Pool discount">− {formatTaka(fare.sharedKmDiscount)} per shared km</Row>
        )}
        <Row label={`Seats (${fare.seats})`}>× {fare.seatMultiplier}</Row>
        <Row label={RIDE_OPTION_LABELS[fare.rideOption]}>× {fare.optionMultiplier}</Row>
        <Row label="Calculated fare">{formatTaka(fare.computedFare)}</Row>
        <Row label="Estimate">{formatTaka(fare.estimatedFare)}</Row>
        <div className="flex items-baseline justify-between gap-4 pt-2.5">
          <dt className="font-medium text-slate-900">Final fare</dt>
          <dd className="text-lg font-semibold tabular-nums">{formatTaka(fare.finalFare)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-slate-500">
        ({fare.baseFare} + {fare.perKmRate} × {fare.actualKm}
        {shared && ` − ${fare.sharedKmDiscount} × ${fare.sharedKm}`}) × {fare.seatMultiplier} ×{' '}
        {fare.optionMultiplier} = {fare.computedFare}. You pay the lower of this and the estimate.
        {(fare.distanceMethod === 'fallback' || fare.routeDistanceMethod === 'fallback') &&
          ' Distances are approximate: the map service was unavailable.'}
      </p>
    </div>
  );
}
