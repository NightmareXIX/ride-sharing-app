'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { AppShell, Card } from '@/components/AppShell';
import { CurrentRequest, FinishedRide } from '@/components/CurrentRequest';
import { FormAlert } from '@/components/forms';
import { RequestRideForm } from '@/components/RequestRideForm';
import type { Account } from '@/lib/account';
import { api, ApiError } from '@/lib/api';
import type { Booking } from '@/lib/booking';
import { formatTaka } from '@/lib/money';
import { useAccount } from '@/lib/useAccount';
import { usePolling } from '@/lib/usePolling';

// The balance changes when a ride is paid for or fined, so the account is read again then.
function PassengerHome({
  account,
  onMoneyMoved,
}: {
  account: Account;
  onMoneyMoved: () => Promise<void>;
}) {
  const router = useRouter();
  const [booking, setBooking] = useState<Booking | null>(account.currentBooking);
  // The ride that just ended, shown until the passenger moves on.
  const [finished, setFinished] = useState<Booking | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const [notice, setNotice] = useState('');
  const [alert, setAlert] = useState('');
  // Bumped by every change made here, so a poll that started before it can't undo it.
  const changes = useRef(0);

  function show(next: Booking | null) {
    changes.current += 1;
    setBooking(next);
  }

  // The ride's status, checked every 4 seconds while there is one (FR-P5, NFR-3).
  usePolling(async () => {
    const startedAt = changes.current;
    try {
      const { booking: current } = await api<{ booking: Booking | null }>('/bookings/current');
      // A ride that ended is no longer current, so it is read by id to show how it ended.
      const ended =
        current === null && booking
          ? (await api<{ booking: Booking }>(`/bookings/${booking.id}`)).booking
          : null;
      if (changes.current !== startedAt) return;
      setBooking(current);
      if (ended) {
        setFinished(ended);
        // A TeslaPay ride was paid for, or a no-show fined.
        void onMoneyMoved();
      }
      setConnectionLost(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace('/login');
      else setConnectionLost(true);
    }
  }, booking !== null);

  async function cancel() {
    if (!booking) return;
    setAlert('');
    try {
      const { booking: cancelled } = await api<{ booking: Booking }>(
        `/bookings/${booking.id}/cancel`,
        { method: 'POST' },
      );
      show(null);
      setNotice(
        cancelled.fine
          ? `Your ride was cancelled. A ${formatTaka(cancelled.fine.amount)} late-cancel fine was taken from your TeslaPay balance.`
          : booking.status === 'REQUESTED'
            ? 'Your request was cancelled. No charge.'
            : 'Your ride was cancelled. No charge.',
      );
      if (cancelled.fine) void onMoneyMoved();
    } catch (err) {
      setAlert((err as Error).message);
      // The ride may have moved on; show where it is now.
      const current = await api<{ booking: Booking | null }>('/bookings/current').catch(() => null);
      if (current) show(current.booking);
    }
  }

  function requested(next: Booking) {
    setNotice('');
    setFinished(null);
    show(next);
  }

  return (
    <div className="space-y-4">
      <FormAlert>{alert}</FormAlert>
      {notice && !booking && (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
          {notice}
        </p>
      )}
      {booking ? (
        <CurrentRequest booking={booking} onCancel={cancel} connectionLost={connectionLost} />
      ) : finished ? (
        <FinishedRide booking={finished} onDone={() => setFinished(null)} />
      ) : (
        <Card label="Where to?">
          <div className="mt-3">
            <RequestRideForm balance={account.wallet.balance} onRequested={requested} />
          </div>
        </Card>
      )}
    </div>
  );
}

export default function PassengerHomePage() {
  const { state, retry, refresh } = useAccount('passenger');

  return (
    <AppShell state={state} retry={retry}>
      {state.status === 'ready' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Hi, {state.account.user.name}</h1>
            <Link
              href="/passenger/wallet"
              className="rounded-lg text-sm text-slate-600 hover:underline focus-visible:outline-2 focus-visible:outline-slate-900"
            >
              TeslaPay{' '}
              <span
                className={`font-semibold tabular-nums ${
                  state.account.wallet.balance.startsWith('-') ? 'text-red-700' : 'text-slate-900'
                }`}
              >
                {formatTaka(state.account.wallet.balance)}
              </span>
            </Link>
          </div>
          <PassengerHome account={state.account} onMoneyMoved={refresh} />
        </div>
      )}
    </AppShell>
  );
}
