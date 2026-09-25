'use client';

import { useState, type ReactNode } from 'react';
import { ChoiceGroup, FieldError, FormAlert } from '@/components/forms';
import { MapPicker, type MapMarker } from '@/components/MapPicker';
import { QuickPicks } from '@/components/QuickPicks';
import { api, ApiError, fieldErrors } from '@/lib/api';
import {
  PAYMENT_METHOD_LABELS,
  RIDE_OPTION_LABELS,
  type Booking,
  type FareQuote,
  type PaymentMethod,
  type RideOption,
} from '@/lib/booking';
import type { LatLng, Place } from '@/lib/geo';
import { formatTaka, toPoysha } from '@/lib/money';
import { describePoint } from '@/lib/places';
import { useSlowFlag } from '@/lib/useSlowFlag';

// The API's hard limit; it also refuses more seats than the largest registered Tesla.
const MAX_SEATS = 6;

type Stop = 'pickup' | 'destination';
type Pending = 'estimate' | 'request' | null;

const primaryButton =
  'flex w-full items-center justify-center rounded-lg bg-slate-900 px-4 py-2.5 text-base font-medium text-white transition hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-60';

const OPTION_CHOICES: ReadonlyArray<{ value: RideOption; label: ReactNode }> = [
  { value: 'pool', label: <ChoiceLabel title="Pool" detail="Share the ride" /> },
  { value: 'same_gender', label: <ChoiceLabel title="Same-gender" detail="+5%" /> },
  { value: 'solo', label: <ChoiceLabel title="Solo" detail="+15%" /> },
];

function ChoiceLabel({ title, detail }: { title: string; detail: string }) {
  return (
    <span className="flex flex-col">
      <span>{title}</span>
      <span className="text-xs font-normal opacity-75">{detail}</span>
    </span>
  );
}

function StopButton({
  stop,
  place,
  active,
  onSelect,
}: {
  stop: Stop;
  place: Place | null;
  active: boolean;
  onSelect: () => void;
}) {
  const dot = stop === 'pickup' ? 'bg-emerald-600' : 'bg-red-600';
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className="flex w-full items-center gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-left transition hover:border-slate-900 focus-visible:outline-2 focus-visible:outline-slate-900 aria-pressed:border-slate-900 aria-pressed:ring-2 aria-pressed:ring-slate-900/15"
    >
      <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${dot}`} />
      <span className="min-w-0">
        <span className="block text-xs font-medium text-slate-500">
          {stop === 'pickup' ? 'Pickup' : 'Destination'}
          {active && ' · choosing'}
        </span>
        <span className={`block truncate ${place ? 'text-slate-900' : 'text-slate-400'}`}>
          {place?.label ?? 'Tap the map or pick a spot'}
        </span>
      </span>
    </button>
  );
}

function SeatStepper({
  seats,
  onChange,
  error,
}: {
  seats: number;
  onChange: (seats: number) => void;
  error?: string;
}) {
  const stepClass =
    'flex size-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-lg text-slate-700 transition hover:border-slate-900 focus-visible:outline-2 focus-visible:outline-slate-900 disabled:opacity-40';
  return (
    <div>
      <p id="seats-label" className="mb-1.5 text-sm font-medium text-slate-700">
        Seats
      </p>
      <div role="group" aria-labelledby="seats-label" className="flex items-center gap-3">
        <button
          type="button"
          aria-label="One seat fewer"
          onClick={() => onChange(seats - 1)}
          disabled={seats <= 1}
          className={stepClass}
        >
          −
        </button>
        <output aria-live="polite" className="w-8 text-center text-lg font-semibold tabular-nums">
          {seats}
        </output>
        <button
          type="button"
          aria-label="One seat more"
          onClick={() => onChange(seats + 1)}
          disabled={seats >= MAX_SEATS}
          className={stepClass}
        >
          +
        </button>
        <span className="text-sm text-slate-500">Each extra seat adds half the fare.</span>
      </div>
      <FieldError id="field-seats-error" message={error && `Seats: ${error}.`} />
    </div>
  );
}

function QuoteCard({
  quote,
  seats,
  rideOption,
}: {
  quote: FareQuote;
  seats: number;
  rideOption: RideOption;
}) {
  return (
    <section
      aria-label="Fare estimate"
      className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-slate-600">Estimated fare</h3>
        <p className="text-2xl font-semibold tabular-nums">{formatTaka(quote.estimatedFare)}</p>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        {quote.directKm} km by road
        {quote.distanceMethod === 'fallback' &&
          ' (approximate: the map service is unavailable, so this uses the straight-line distance × 1.3)'}
      </p>
      <p className="mt-1 text-sm text-slate-600 tabular-nums">
        ({formatTaka(quote.baseFare)} + {formatTaka(quote.perKmRate)} × {quote.directKm} km) ×{' '}
        {quote.seatMultiplier} for {seats} {seats === 1 ? 'seat' : 'seats'} ×{' '}
        {quote.optionMultiplier} for {RIDE_OPTION_LABELS[rideOption]}
      </p>
      <p className="mt-2 text-sm text-slate-500">
        You never pay more than this. Sharing the ride can make it cheaper.
      </p>
    </section>
  );
}

// Choose a trip, see its price, and request the ride (FR-P3, FR-P4).
export function RequestRideForm({
  balance,
  onRequested,
}: {
  balance: string;
  onRequested: (booking: Booking) => void;
}) {
  const [pickup, setPickup] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [choosing, setChoosing] = useState<Stop>('pickup');
  const [seats, setSeats] = useState(1);
  const [rideOption, setRideOption] = useState<RideOption>('pool');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [quote, setQuote] = useState<FareQuote | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [alert, setAlert] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const slow = useSlowFlag(pending !== null);

  // Any change makes the shown price stale, so it is cleared (the price always matches).
  function changed() {
    setQuote(null);
    setAlert('');
    setErrors({});
  }

  function setStop(place: Place) {
    changed();
    if (choosing === 'pickup') {
      setPickup(place);
      if (!destination) setChoosing('destination');
    } else {
      setDestination(place);
    }
  }

  const pickOnMap = (point: LatLng) => setStop({ ...point, label: describePoint(point) });

  function showError(err: unknown) {
    if (!(err instanceof ApiError)) {
      setAlert((err as Error).message);
      return;
    }
    const fields = fieldErrors(err);
    setErrors(fields);
    const known = ['seats', 'pickup', 'destination'];
    const unshown = Object.keys(fields).filter(
      (path) => !known.some((prefix) => path === prefix || path.startsWith(`${prefix}.`)),
    );
    if (Object.keys(fields).length === 0 || unshown.length > 0) setAlert(err.message);
  }

  async function getEstimate() {
    if (!pickup || !destination) return;
    setPending('estimate');
    setAlert('');
    setErrors({});
    try {
      setQuote(
        await api<FareQuote>('/fare-estimates', {
          method: 'POST',
          body: { pickup, destination, seats, rideOption },
        }),
      );
    } catch (err) {
      showError(err);
    } finally {
      setPending(null);
    }
  }

  async function requestRide() {
    if (!pickup || !destination) return;
    setPending('request');
    setAlert('');
    try {
      const { booking } = await api<{ booking: Booking }>('/bookings', {
        method: 'POST',
        body: { pickup, destination, seats, rideOption, paymentMethod },
      });
      onRequested(booking);
    } catch (err) {
      // The passenger already has a ride (e.g. from another tab): show that one instead.
      if (err instanceof ApiError && err.code === 'ACTIVE_BOOKING_EXISTS') {
        const current = await api<{ booking: Booking | null }>('/bookings/current').catch(
          () => null,
        );
        if (current?.booking) {
          onRequested(current.booking);
          return;
        }
      }
      showError(err);
      setPending(null);
    }
  }

  const markers: MapMarker[] = [];
  if (pickup) markers.push({ key: 'pickup', point: pickup, label: 'Pickup', tone: 'pickup' });
  if (destination) {
    markers.push({
      key: 'destination',
      point: destination,
      label: 'Destination',
      tone: 'destination',
    });
  }

  const stopEntry = Object.entries(errors).find(
    ([path]) => path.startsWith('pickup') || path.startsWith('destination'),
  );
  const stopError =
    stopEntry && `${stopEntry[0].startsWith('pickup') ? 'Pickup' : 'Destination'} ${stopEntry[1]}.`;
  const teslaPayShort =
    quote !== null &&
    paymentMethod === 'teslapay' &&
    toPoysha(balance) < toPoysha(quote.estimatedFare);
  const negativeBalance = toPoysha(balance) < 0n;
  const busy = pending !== null;

  return (
    <div className="space-y-5">
      <FormAlert>{alert}</FormAlert>
      {negativeBalance && (
        <FormAlert>Your balance is below zero. Top up before requesting a ride.</FormAlert>
      )}

      <div className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <StopButton
            stop="pickup"
            place={pickup}
            active={choosing === 'pickup'}
            onSelect={() => setChoosing('pickup')}
          />
          <StopButton
            stop="destination"
            place={destination}
            active={choosing === 'destination'}
            onSelect={() => setChoosing('destination')}
          />
        </div>
        <FieldError id="field-stops-error" message={stopError} />
      </div>

      <MapPicker
        label={`Map of Dhaka. Tap to set the ${choosing}.`}
        markers={markers}
        onPick={busy ? undefined : pickOnMap}
      />
      <div>
        <p className="mb-2 text-sm text-slate-500">
          Or choose a spot for the {choosing === 'pickup' ? 'pickup' : 'destination'}:
        </p>
        <QuickPicks
          onPick={setStop}
          disabled={busy}
          selected={(choosing === 'pickup' ? pickup : destination)?.label}
        />
      </div>

      <SeatStepper
        seats={seats}
        onChange={(next) => {
          changed();
          setSeats(next);
        }}
        error={errors.seats}
      />
      <ChoiceGroup
        name="rideOption"
        legend="Ride option"
        columns={3}
        value={rideOption}
        onChange={(next) => {
          changed();
          setRideOption(next);
        }}
        options={OPTION_CHOICES}
      />
      <ChoiceGroup
        name="paymentMethod"
        legend="Payment"
        value={paymentMethod}
        onChange={(next) => {
          setAlert('');
          setPaymentMethod(next);
        }}
        options={[
          { value: 'cash', label: PAYMENT_METHOD_LABELS.cash },
          {
            value: 'teslapay',
            label: <ChoiceLabel title="TeslaPay" detail={formatTaka(balance)} />,
          },
        ]}
      />

      {quote ? (
        <>
          <QuoteCard quote={quote} seats={seats} rideOption={rideOption} />
          {teslaPayShort && (
            <p className="text-sm text-amber-700">
              Your TeslaPay balance doesn’t cover this fare. Choose Cash to ride now.
            </p>
          )}
          <button
            type="button"
            onClick={requestRide}
            disabled={busy || teslaPayShort || negativeBalance}
            className={primaryButton}
          >
            {pending === 'request'
              ? slow
                ? 'Calculating route…'
                : 'Requesting…'
              : `Request ride · ${formatTaka(quote.estimatedFare)}`}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={getEstimate}
          disabled={busy || !pickup || !destination}
          className={primaryButton}
        >
          {pending === 'estimate'
            ? slow
              ? 'Calculating route…'
              : 'Getting estimate…'
            : 'Get fare estimate'}
        </button>
      )}
    </div>
  );
}
