'use client';

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
import { api, ApiError } from '@/lib/api';
import type { LatLng } from '@/lib/geo';
import { formatTaka } from '@/lib/money';
import { describePoint } from '@/lib/places';
import type { CompletedTrip, DriverTrip, NearbyRequest, TripBooking } from '@/lib/trip';
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

function DriverDashboard({ account }: { account: Account }) {
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
      setNotice(`You cancelled ${booking.passenger.name}'s ride. It's back with other drivers.`);
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

  const markers: MapMarker[] = [];
  if (vehicle.location) {
    markers.push({ key: 'tesla', point: vehicle.location, label: vehicle.name, tone: 'driver' });
  }
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
  // The stops still to come, in order, from where the route goes on.
  const stops = trip?.stops ?? [];
  const lastReached = stops.filter((stop) => stop.actualOdometerKm !== null).at(-1);
  const routeStart = lastReached?.place ?? vehicle.location;
  const ahead = stops.filter((stop) => stop.actualOdometerKm === null).map((stop) => stop.place);
  const routePath = routeStart && ahead.length > 0 ? [routeStart, ...ahead] : undefined;

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
        <DriverTripCard trip={trip} pendingId={stepping} onStep={step} onCancel={cancelRide} />
      )}
      {searching && (
        <NearbyRequests
          requests={requests}
          onTrip={onTrip}
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
        </Card>
      </div>

      <Card label="Your location">
        <p className="mb-3 text-slate-900">
          {vehicle.location ? describePoint(vehicle.location) : 'Not set yet'}
        </p>
        <MapPicker
          label={
            onTrip ? 'Map of your current ride.' : 'Map of Dhaka. Tap to choose your location.'
          }
          markers={markers}
          path={routePath}
          onPick={busy === null && !onTrip ? setDraft : undefined}
        />
        {onTrip ? (
          <p className="mt-3 text-sm text-slate-500">
            Your location stays put while you have a passenger. The dashed line shows the order of
            your stops, not the road.
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
  const { state, retry } = useAccount('driver');

  return (
    <AppShell state={state} retry={retry}>
      {state.status === 'ready' && (
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">Hi, {state.account.user.name}</h1>
          <DriverDashboard account={state.account} />
        </div>
      )}
    </AppShell>
  );
}
