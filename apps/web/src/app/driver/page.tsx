'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell, Card } from '@/components/AppShell';
import { primaryButton, secondaryButton } from '@/components/buttons';
import { CompletedRideCard, DriverTripCard, type CompletedRide } from '@/components/DriverTripCard';
import { FormAlert } from '@/components/forms';
import { MapPicker, type MapMarker } from '@/components/MapPicker';
import { NearbyRequests } from '@/components/NearbyRequests';
import { QuickPicks } from '@/components/QuickPicks';
import { SeatMeter } from '@/components/SeatMeter';
import type { Account } from '@/lib/account';
import { FINE_AMOUNT } from '@/lib/booking';
import { api, ApiError } from '@/lib/api';
import type { LatLng } from '@/lib/geo';
import { formatTaka } from '@/lib/money';
import { describePoint } from '@/lib/places';
import {
  describeSpot,
  teslaSpot,
  type CompletedTrip,
  type DriverTrip,
  type NearbyRequest,
  type TripBooking,
} from '@/lib/trip';
import { useAccount } from '@/lib/useAccount';
import { usePolling } from '@/lib/usePolling';
import type { DriverVehicle } from '@/lib/vehicle';

type Busy = 'availability' | 'location' | null;

function StatusPill({ online }: { online: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        online ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
      }`}
    >
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-slate-400'}`}
      />
      {online ? 'Online' : 'Offline'}
    </span>
  );
}

// The balance changes when a TeslaPay ride is paid for, so the account is read again then.
function DriverDashboard({
  account,
  onMoneyMoved,
}: {
  account: Account;
  onMoneyMoved: () => Promise<void>;
}) {
  const router = useRouter();
  const [vehicle, setVehicle] = useState<DriverVehicle | null>(null);
  const [trip, setTrip] = useState<DriverTrip | null>(null);
  const [requests, setRequests] = useState<NearbyRequest[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  // A point chosen on the map but not saved yet.
  const [draft, setDraft] = useState<LatLng | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  // The passenger whose trip action is running.
  const [stepping, setStepping] = useState<string | null>(null);
  const [completed, setCompleted] = useState<CompletedRide | null>(null);
  const [notice, setNotice] = useState('');
  const [alert, setAlert] = useState('');
  const [connectionLost, setConnectionLost] = useState(false);
  // Bumped by every trip change made here, so a poll that started before it can't undo it.
  const tripChanges = useRef(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<{ vehicle: DriverVehicle }>('/driver/vehicle'),
      api<{ pool: DriverTrip | null }>('/driver/pool'),
    ]).then(
      ([vehicleBody, tripBody]) => {
        if (cancelled) return;
        setVehicle(vehicleBody.vehicle);
        setTrip(tripBody.pool);
      },
      (err: unknown) => {
        if (!cancelled) setLoadError((err as Error).message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setLoadError('');
    setAttempt((n) => n + 1);
  }, []);

  function showTrip(next: DriverTrip | null) {
    tripChanges.current += 1;
    setTrip(next);
  }

  const lostTouch = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) router.replace('/login');
      else setConnectionLost(true);
    },
    [router],
  );

  // The Tesla's seats: the trip reports them as they stand, and with no trip all are free.
  const seats = trip?.seats ?? { capacity: vehicle?.capacity ?? 0, taken: 0 };
  const seatsFree = seats.capacity - seats.taken;

  // Nearby requests, while online with a seat free (FR-D5, FR-D6, FR-D9, NFR-3).
  const searching = vehicle?.isOnline === true && seatsFree > 0;
  const refreshRequests = useCallback(async () => {
    try {
      const body = await api<{ requests: NearbyRequest[] }>('/driver/requests');
      setRequests(body.requests);
      setConnectionLost(false);
    } catch (err) {
      lostTouch(err);
    }
  }, [lostTouch]);

  // The first check runs straight away; the rest every 4 seconds.
  usePolling(refreshRequests, searching, { immediate: true });

  // The trip in progress: a passenger may cancel at any moment (FR-P7).
  usePolling(async () => {
    const startedAt = tripChanges.current;
    const before = trip?.bookings ?? [];
    try {
      const body = await api<{ pool: DriverTrip | null }>('/driver/pool');
      if (tripChanges.current !== startedAt) return;
      // This driver's own steps update the trip straight away, so a passenger who leaves
      // between polls has cancelled.
      const after = new Set(body.pool?.bookings.map((booking) => booking.id));
      const gone = before.filter((booking) => !after.has(booking.id));
      if (gone.length > 0) {
        const names = gone.map((booking) => booking.passenger.name).join(' and ');
        setNotice(`${names} cancelled ${gone.length === 1 ? 'their ride' : 'their rides'}.`);
      }
      setTrip(body.pool);
      setConnectionLost(false);
    } catch (err) {
      lostTouch(err);
    }
  }, trip !== null);

  // When a trip ends, the API leaves the Tesla where it ended (driver-map LLD §3). It stays
  // where the map last showed it, rather than jumping back, until the Tesla is read again.
  const lastStop = useRef<LatLng | null>(null);
  useEffect(() => {
    if (trip) {
      lastStop.current = teslaSpot(null, trip)?.point ?? null;
      return;
    }
    const endedAt = lastStop.current;
    if (!endedAt) return;
    lastStop.current = null;
    setVehicle((shown) => (shown ? { ...shown, location: endedAt } : shown));
    api<{ vehicle: DriverVehicle }>('/driver/vehicle').then(
      (body) => setVehicle(body.vehicle),
      () => {},
    );
  }, [trip]);

  // One action at a time; its buttons stay disabled until it finishes (NFR-37).
  async function run(kind: Exclude<Busy, null>, call: () => Promise<{ vehicle: DriverVehicle }>) {
    setBusy(kind);
    setAlert('');
    try {
      const body = await call();
      setVehicle(body.vehicle);
      if (kind === 'location') setDraft(null);
      if (!body.vehicle.isOnline) setRequests(null);
    } catch (err) {
      setAlert((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const toggleOnline = () =>
    run('availability', () =>
      api(`/driver/vehicle/${vehicle?.isOnline ? 'offline' : 'online'}`, { method: 'POST' }),
    );

  const saveLocation = (point: LatLng) =>
    run('location', () =>
      api('/driver/vehicle/location', {
        method: 'PUT',
        body: { lat: point.lat, lng: point.lng },
      }),
    );

  // Everything is checked again on the server; the list may be a few seconds old.
  async function accept(request: NearbyRequest) {
    setAccepting(request.id);
    setAlert('');
    setNotice('');
    try {
      const body = await api<{ pool: DriverTrip | null }>(`/driver/requests/${request.id}/accept`, {
        method: 'POST',
      });
      showTrip(body.pool);
      // With seats still free, the rest of the list stays up.
      setRequests((listed) => listed?.filter((other) => other.id !== request.id) ?? null);
    } catch (err) {
      // Another accept may have taken the seats or the request: show the list as it is now.
      setAlert((err as Error).message);
      void refreshRequests();
    } finally {
      setAccepting(null);
    }
  }

  // Moves one passenger a step: arrived, started, then dropped off (FR-D10).
  async function step(booking: TripBooking) {
    const action = booking.nextAction;
    setStepping(booking.id);
    setAlert('');
    try {
      const path = `/driver/bookings/${booking.id}/${action}`;
      if (action === 'complete') {
        const body = await api<CompletedTrip>(path, { method: 'POST' });
        setCompleted({
          passengerName: booking.passenger.name,
          paymentMethod: booking.paymentMethod,
          fare: body.fare,
        });
        showTrip(body.pool);
        if (booking.paymentMethod === 'teslapay') void onMoneyMoved();
      } else {
        const body = await api<{ pool: DriverTrip | null }>(path, { method: 'POST' });
        showTrip(body.pool);
      }
    } catch (err) {
      setAlert((err as Error).message);
    } finally {
      setStepping(null);
    }
  }

  // Before pickup only; the request goes back to other drivers (FR-D12).
  async function cancelRide(booking: TripBooking) {
    setStepping(booking.id);
    setAlert('');
    try {
      const body = await api<{ pool: DriverTrip | null }>(`/driver/bookings/${booking.id}/cancel`, {
        method: 'POST',
      });
      showTrip(body.pool);
      setNotice(
        `You cancelled ${booking.passenger.name}'s ride. It's back with other drivers.${
          booking.cancelRecordsPenalty ? ' A late-cancel penalty was recorded against you.' : ''
        }`,
      );
      // The penalty count may have gone up (FR-D13).
      if (booking.cancelRecordsPenalty) {
        const latest = await api<{ vehicle: DriverVehicle }>('/driver/vehicle').catch(() => null);
        if (latest) setVehicle(latest.vehicle);
      }
    } catch (err) {
      setAlert((err as Error).message);
    } finally {
      setStepping(null);
    }
  }

  // 5 minutes after arriving; the passenger is fined and the route goes on (FR-D11).
  async function noShow(booking: TripBooking) {
    setStepping(booking.id);
    setAlert('');
    try {
      const body = await api<{ pool: DriverTrip | null }>(
        `/driver/bookings/${booking.id}/no-show`,
        { method: 'POST' },
      );
      showTrip(body.pool);
      setNotice(
        `${booking.passenger.name} was marked as a no-show and fined ${formatTaka(FINE_AMOUNT)}.`,
      );
    } catch (err) {
      setAlert((err as Error).message);
    } finally {
      setStepping(null);
    }
  }

  if (loadError) {
    return (
      <div role="alert" className="rounded-xl bg-white p-6 ring-1 ring-slate-200">
        <p className="text-slate-700">{loadError}</p>
        <button type="button" onClick={retry} className={`mt-4 ${primaryButton}`}>
          Try again
        </button>
      </div>
    );
  }
  if (!vehicle) {
    return (
      <p role="status" className="text-slate-500">
        Loading your Tesla…
      </p>
    );
  }

  // A driver with a passenger stays online and in place (FR-D3).
  const onTrip = trip !== null;

  // Where the driver is: the stop reached, or the saved location (driver-map LLD §2).
  const spot = teslaSpot(vehicle.location, trip);
  const tesla = spot ? { point: spot.point, label: vehicle.name } : undefined;
  const markers: MapMarker[] = [];
  if (draft) markers.push({ key: 'draft', point: draft, label: 'New location', tone: 'draft' });
  for (const booking of trip?.bookings ?? []) {
    markers.push({
      key: `pickup-${booking.id}`,
      point: booking.pickup,
      label: `Pickup: ${booking.passenger.name}`,
      tone: 'pickup',
    });
    markers.push({
      key: `destination-${booking.id}`,
      point: booking.destination,
      label: booking.destination.label,
      tone: 'destination',
    });
  }
  // The stops still to come, in order, from the Tesla. A pickup it waits at isn't ahead.
  const ahead = (trip?.stops ?? [])
    .filter((stop) => stop.actualOdometerKm === null && stop !== spot?.stop)
    .map((stop) => stop.place);
  const routePath = spot && ahead.length > 0 ? [spot.point, ...ahead] : undefined;

  if (searching) {
    for (const request of requests ?? []) {
      markers.push({
        key: `request-${request.id}`,
        point: request.pickup,
        label: request.pickup.label,
        tone: 'pickup',
      });
    }
  }

  return (
    <div className="space-y-4">
      <FormAlert>{alert}</FormAlert>
      {connectionLost && (
        <p role="status" className="text-sm text-amber-700">
          Can’t reach the server. Still trying…
        </p>
      )}

      {notice && (
        <p role="status" className="rounded-lg bg-slate-100 px-3 py-2.5 text-sm text-slate-700">
          {notice}
        </p>
      )}
      {completed && <CompletedRideCard ride={completed} onDismiss={() => setCompleted(null)} />}
      {trip && (
        <DriverTripCard
          trip={trip}
          pendingId={stepping}
          onStep={step}
          onCancel={cancelRide}
          onNoShow={noShow}
        />
      )}
      {searching && (
        <NearbyRequests
          requests={requests}
          onTrip={onTrip}
          joinRule={trip?.joinRule ?? 'anyone'}
          freeSeats={seatsFree}
          accepting={accepting}
          onAccept={accept}
        />
      )}
      {vehicle.isOnline && seatsFree === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 p-5 text-slate-600">
          {vehicle.name} is full. New requests show here again when a seat frees up.
        </p>
      )}
      {!vehicle.isOnline && (
        <p className="rounded-xl border border-dashed border-slate-300 p-5 text-slate-600">
          Go online to receive ride requests.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card label="Your Tesla">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-3xl font-semibold">{vehicle.name}</p>
              <div className="mt-2">
                <SeatMeter capacity={seats.capacity} taken={seats.taken} />
              </div>
            </div>
            <StatusPill online={vehicle.isOnline} />
          </div>
          <button
            type="button"
            onClick={toggleOnline}
            disabled={busy !== null || onTrip}
            className={`mt-4 w-full ${vehicle.isOnline ? secondaryButton : primaryButton}`}
          >
            {busy === 'availability'
              ? vehicle.isOnline
                ? 'Going offline…'
                : 'Going online…'
              : vehicle.isOnline
                ? 'Go offline'
                : 'Go online'}
          </button>
          {onTrip ? (
            <p className="mt-2 text-sm text-slate-500">
              Finish or cancel your current ride before going offline.
            </p>
          ) : (
            !vehicle.location && (
              <p className="mt-2 text-sm text-slate-500">Set your location to go online.</p>
            )
          )}
        </Card>
        <Card label="TeslaPay balance">
          <p className="text-3xl font-semibold tabular-nums">
            {formatTaka(account.wallet.balance)}
          </p>
          <Link
            href="/driver/trips"
            className="mt-2 inline-block text-sm font-medium text-slate-700 underline underline-offset-2"
          >
            See your earnings
          </Link>
          {vehicle.penaltyCount > 0 && (
            <p className="mt-3 text-sm text-amber-700">
              {vehicle.penaltyCount} late {vehicle.penaltyCount === 1 ? 'cancel' : 'cancels'} on
              your record.
            </p>
          )}
        </Card>
      </div>

      <Card label="Your location">
        <p className="mb-3 text-slate-900">
          {spot?.stop
            ? describeSpot(spot.stop)
            : vehicle.location
              ? describePoint(vehicle.location)
              : 'Not set yet'}
        </p>
        <MapPicker
          label={
            onTrip ? 'Map of your current ride.' : 'Map of Dhaka. Tap to choose your location.'
          }
          markers={markers}
          tesla={tesla}
          path={routePath}
          onPick={busy === null && !onTrip ? setDraft : undefined}
        />
        {onTrip ? (
          <p className="mt-3 text-sm text-slate-500">
            Your Tesla moves to each stop as you reach it. The arrows show the order of your stops;
            the dashed line isn’t the road.
          </p>
        ) : (
          <>
            <p className="mt-3 text-sm text-slate-500">
              Tap the map or choose a spot below, then save it.
            </p>
            <div className="mt-3">
              <QuickPicks onPick={setDraft} disabled={busy !== null} />
            </div>
          </>
        )}
        {draft && !onTrip && (
          <div className="mt-4 flex flex-col gap-2 rounded-lg bg-blue-50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-blue-900">
              New location: <span className="font-medium">{describePoint(draft)}</span>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDraft(null)}
                disabled={busy !== null}
                className={secondaryButton}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => saveLocation(draft)}
                disabled={busy !== null}
                className={primaryButton}
              >
                {busy === 'location' ? 'Saving…' : 'Save location'}
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function DriverHomePage() {
  const { state, retry, refresh } = useAccount('driver');

  return (
    <AppShell state={state} retry={retry}>
      {state.status === 'ready' && (
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">Hi, {state.account.user.name}</h1>
          <DriverDashboard account={state.account} onMoneyMoved={refresh} />
        </div>
      )}
    </AppShell>
  );
}
