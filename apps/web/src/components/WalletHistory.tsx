'use client';

import { formatTaka } from '@/lib/money';
import { formatDhakaTime } from '@/lib/time';
import { describeTransaction, type WalletTransaction } from '@/lib/wallet';
import { ListFooter } from './ListFooter';

function Entry({ entry }: { entry: WalletTransaction }) {
  const moneyIn = !entry.amount.startsWith('-');
  return (
    <li className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="font-medium text-slate-900">{describeTransaction(entry)}</p>
        <p className="mt-0.5 text-sm text-slate-500">{formatDhakaTime(entry.createdAt)}</p>
      </div>
      <div className="shrink-0 text-right">
        <p
          className={`font-semibold tabular-nums ${moneyIn ? 'text-emerald-700' : 'text-red-700'}`}
        >
          {moneyIn ? '+' : ''}
          {formatTaka(entry.amount)}
        </p>
        <p className="mt-0.5 text-sm text-slate-500 tabular-nums">
          {entry.type === 'cash_earning'
            ? 'Cash, not in your wallet'
            : `Balance ${formatTaka(entry.balanceAfter)}`}
        </p>
      </div>
    </li>
  );
}

// Every money movement, newest first, a page at a time (FR-W8, NFR-36).
export function WalletHistory({
  entries,
  hasMore,
  loading,
  error,
  onLoadMore,
}: {
  // Null until the first page arrives.
  entries: WalletTransaction[] | null;
  hasMore: boolean;
  loading: boolean;
  error: string;
  onLoadMore: () => void;
}) {
  return (
    <section
      aria-labelledby="wallet-history-heading"
      className="rounded-xl bg-white p-5 ring-1 ring-slate-200"
    >
      <h2 id="wallet-history-heading" className="text-sm font-medium text-slate-500">
        History
      </h2>
      {entries === null && !error && (
        <p role="status" className="mt-3 text-slate-500">
          Loading your history…
        </p>
      )}
      {entries?.length === 0 && <p className="mt-3 text-slate-600">No money has moved yet.</p>}
      {entries && entries.length > 0 && (
        <ul className="mt-1 divide-y divide-slate-100">
          {entries.map((entry) => (
            <Entry key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
      <ListFooter
        shown={entries !== null}
        hasMore={hasMore}
        loading={loading}
        error={error}
        onLoadMore={onLoadMore}
      />
    </section>
  );
}
