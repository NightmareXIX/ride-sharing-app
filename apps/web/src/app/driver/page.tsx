'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell, Card } from '@/components/AppShell';
import { FormAlert } from '@/components/forms';
import { MapPicker, type MapMarker } from '@/components/MapPicker';
import { QuickPicks } from '@/components/QuickPicks';
import type { Account } from '@/lib/account';
import { api } from '@/lib/api';
import type { LatLng } from '@/lib/geo';
import { formatTaka } from '@/lib/money';
import { describePoint } from '@/lib/places';
import { useAccount } from '@/lib/useAccount';
import type { DriverVehicle } from '@/lib/vehicle';

type Busy = 'availability' | 'location' | null;

const primaryButton =
  'rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-wait disabled:opacity-70';
const secondaryButton =
  'rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-wait disabled:opacity-70';

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
  const [vehicle, setVehicle] = useState<DriverVehicle | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  // A point chosen on the map but not saved yet.
  const [draft, setDraft] = useState<LatLng | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [alert, setAlert] = useState('');

  useEffect(() => {
    let cancelled = false;
    api<{ vehicle: DriverVehicle }>('/driver/vehicle').then(
      (body) => {
        if (!cancelled) setVehicle(body.vehicle);
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

  // One action at a time; its buttons stay disabled until it finishes (NFR-37).
  async function run(kind: Exclude<Busy, null>, call: () => Promise<{ vehicle: DriverVehicle }>) {
    setBusy(kind);
    setAlert('');
    try {
      const body = await call();
      setVehicle(body.vehicle);
      if (kind === 'location') setDraft(null);
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

  const markers: MapMarker[] = [];
  if (vehicle.location) {
    markers.push({ key: 'tesla', point: vehicle.location, label: vehicle.name, tone: 'driver' });
  }
  if (draft) markers.push({ key: 'draft', point: draft, label: 'New location', tone: 'draft' });

  return (
    <div className="space-y-4">
      <FormAlert>{alert}</FormAlert>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card label="Your Tesla">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-3xl font-semibold">{vehicle.name}</p>
              <p className="mt-1 text-slate-600">
                {vehicle.capacity} passenger {vehicle.capacity === 1 ? 'seat' : 'seats'}
              </p>
            </div>
            <StatusPill online={vehicle.isOnline} />
          </div>
          <button
            type="button"
            onClick={toggleOnline}
            disabled={busy !== null}
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
          {!vehicle.location && (
            <p className="mt-2 text-sm text-slate-500">Set your location to go online.</p>
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
          label="Map of Dhaka. Tap to choose your location."
          markers={markers}
          onPick={busy === null ? setDraft : undefined}
        />
        <p className="mt-3 text-sm text-slate-500">
          Tap the map or choose a spot below, then save it.
        </p>
        <div className="mt-3">
          <QuickPicks onPick={setDraft} disabled={busy !== null} />
        </div>
        {draft && (
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

      <p className="rounded-xl border border-dashed border-slate-300 p-5 text-slate-600">
        {vehicle.isOnline
          ? 'You’re online. Ride requests will show up here soon.'
          : 'Go online to receive ride requests.'}
      </p>
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
