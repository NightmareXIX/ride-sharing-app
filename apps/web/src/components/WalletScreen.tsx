'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Role } from '@/lib/account';
import { api } from '@/lib/api';
import { formatTaka } from '@/lib/money';
import type { TopUpResult, TransactionPage, Wallet, WalletTransaction } from '@/lib/wallet';
import { Card } from './AppShell';
import { primaryButton } from './buttons';
import { TopUpForm } from './TopUpForm';
import { WalletHistory } from './WalletHistory';

const PAGE_SIZE = 20;

// The balance and the first page of history, read afresh.
function readWallet() {
  return Promise.all([
    api<{ wallet: Wallet }>('/wallet'),
    api<TransactionPage>(`/wallet/transactions?limit=${PAGE_SIZE}`),
  ]);
}

// A user's TeslaPay wallet: the balance, a top-up for passengers, and every movement.
export function WalletScreen({ role }: { role: Role }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [entries, setEntries] = useState<WalletTransaction[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState('');

  const show = useCallback(([walletBody, page]: Awaited<ReturnType<typeof readWallet>>) => {
    setWallet(walletBody.wallet);
    setEntries(page.transactions);
    setCursor(page.nextCursor);
    setHistoryError('');
  }, []);

  useEffect(() => {
    let cancelled = false;
    readWallet().then(
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

  async function loadMore() {
    setLoadingMore(true);
    setHistoryError('');
    try {
      const query = `limit=${PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page = await api<TransactionPage>(`/wallet/transactions?${query}`);
      setEntries((shown) => [...(cursor ? (shown ?? []) : []), ...page.transactions]);
      setCursor(page.nextCursor);
    } catch (err) {
      setHistoryError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  function toppedUp(result: TopUpResult) {
    setWallet(result.wallet);
    // The new entry heads the history, so the first page is read again.
    readWallet().then(show, (err: unknown) => setHistoryError((err as Error).message));
  }

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
  if (!wallet) {
    return (
      <p role="status" className="text-slate-500">
        Loading your wallet…
      </p>
    );
  }

  const negative = wallet.balance.startsWith('-');
  return (
    <div className="space-y-4">
      <Card label="TeslaPay balance">
        <p
          className={`text-3xl font-semibold tabular-nums ${negative ? 'text-red-700' : 'text-slate-900'}`}
        >
          {formatTaka(wallet.balance)}
        </p>
        {negative && role === 'passenger' && (
          <p className="mt-2 text-sm text-red-700">
            Your balance is below zero after a fine. Top up to zero or more to request rides again.
          </p>
        )}
        {role === 'driver' && (
          <p className="mt-2 text-sm text-slate-500">
            TeslaPay fares are paid in here. Cash fares are listed but stay in your hand.
          </p>
        )}
      </Card>
      {role === 'passenger' && (
        <Card label="Top up">
          <div className="mt-3">
            <TopUpForm onToppedUp={toppedUp} />
          </div>
        </Card>
      )}
      <WalletHistory
        entries={entries}
        hasMore={cursor !== null}
        loading={loadingMore}
        error={historyError}
        onLoadMore={loadMore}
      />
    </div>
  );
}
