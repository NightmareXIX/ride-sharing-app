'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Earnings, TripPage, TripSummary } from '@/lib/history';
import { formatTaka } from '@/lib/money';
import { formatDhakaTime } from '@/lib/time';
import { usePagedList } from '@/lib/usePagedList';
import { Card } from './AppShell';
import { primaryButton } from './buttons';
import { ListFooter } from './ListFooter';

const PAGE_SIZE = 20;

// A page of the driver's finished trips; the first page when there is no cursor.
async function readTrips(cursor: string | null) {
  const query = `limit=${PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
  const page = await api<TripPage>(`/driver/pools?${query}`);
  return { items: page.pools, nextCursor: page.nextCursor };
}

// The totals and the first page of trips, read together.
function readHistory() {
  return Promise.all([api<{ earnings: Earnings }>('/driver/earnings'), readTrips(null)]);
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function Trip({ trip }: { trip: TripSummary }) {
  const earned = trip.earnings.total !== '0.00';
  return (
    <li>
      <Link
        href={`/driver/trips/${trip.id}`}
        className="-mx-2 flex items-start justify-between gap-4 rounded-lg px-2 py-3 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-slate-900"
      >
        <div className="min-w-0">
          <p className="font-medium text-slate-900">
            {formatDhakaTime(trip.finishedAt ?? trip.createdAt)}
          </p>
          <p className="mt-0.5 text-sm text-slate-500">
            {plural(trip.passengers, 'passenger')} · {trip.completed} completed
          </p>
        </div>
        <p
          className={`shrink-0 text-right tabular-nums ${earned ? 'font-semibold text-emerald-700' : 'text-sm text-slate-500'}`}
        >
          {earned ? formatTaka(trip.earnings.total) : 'No earnings'}
        </p>
      </Link>
    </li>
  );
}

// The driver's earnings and finished trips, newest first (FR-D15, NFR-36).
export function DriverHistory() {
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const trips = usePagedList(readTrips);
  const { showFirst } = trips;

  const show = useCallback(
    ([body, page]: Awaited<ReturnType<typeof readHistory>>) => {
      setEarnings(body.earnings);
      showFirst(page);
    },
    [showFirst],
  );

  useEffect(() => {
    let cancelled = false;
    readHistory().then(
      (read) => {
        if (!cancelled) show(read);
      },
      (err: unknown) => {
        if (!cancelled) setLoadError((err as Error).message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [show, attempt]);

  if (loadError) {
    return (
      <div role="alert" className="rounded-xl bg-white p-6 ring-1 ring-slate-200">
        <p className="text-slate-700">{loadError}</p>
        <button
          type="button"
          onClick={() => {
            setLoadError('');
            setAttempt((n) => n + 1);
          }}
          className={`mt-4 ${primaryButton}`}
        >
          Try again
        </button>
      </div>
    );
  }
  if (!earnings) {
    return (
      <p role="status" className="text-slate-500">
        Loading your trips…
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <Card label="Earnings">
        <p className="text-3xl font-semibold tabular-nums">{formatTaka(earnings.total)}</p>
        <dl className="mt-3 grid grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-slate-500">Cash</dt>
            <dd className="mt-0.5 font-medium tabular-nums">{formatTaka(earnings.cash)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">TeslaPay</dt>
            <dd className="mt-0.5 font-medium tabular-nums">{formatTaka(earnings.teslapay)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Rides</dt>
            <dd className="mt-0.5 font-medium tabular-nums">{earnings.rides}</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-slate-500">
          Every completed ride. Cash fares were paid to you in person; TeslaPay fares went to your
          wallet.
        </p>
      </Card>

      <section
        aria-labelledby="trip-history-heading"
        className="rounded-xl bg-white p-5 ring-1 ring-slate-200"
      >
        <h2 id="trip-history-heading" className="text-sm font-medium text-slate-500">
          Past trips
        </h2>
        {trips.items?.length === 0 && (
          <p className="mt-3 text-slate-600">
            No finished trips yet. A trip appears here once its last passenger is dropped off or
            cancelled.
          </p>
        )}
        {trips.items && trips.items.length > 0 && (
          <ul className="mt-1 divide-y divide-slate-100">
            {trips.items.map((trip) => (
              <Trip key={trip.id} trip={trip} />
            ))}
          </ul>
        )}
        <ListFooter
          hasMore={trips.hasMore}
          loading={trips.loading}
          error={trips.error}
          onLoadMore={trips.loadMore}
        />
      </section>
    </div>
  );
}
