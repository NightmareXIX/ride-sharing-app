'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { homePath, type Account, type Role } from './account';
import { api, ApiError } from './api';

export type AccountState =
  | { status: 'loading' }
  | { status: 'ready'; account: Account }
  | { status: 'error'; message: string };

// Loads the signed-in account for a role's pages. The server decides: no session sends
// the visitor to sign in, and the other role is sent to its own home.
export function useAccount(role: Role) {
  const router = useRouter();
  const [state, setState] = useState<AccountState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<Account>('/me').then(
      (account) => {
        if (cancelled) return;
        if (account.user.role !== role) router.replace(homePath(account.user.role));
        else setState({ status: 'ready', account });
      },
      (err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) router.replace('/login');
        else setState({ status: 'error', message: (err as Error).message });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [role, router, attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  // Reads the account again without a loading state, e.g. for the balance after a ride is
  // paid for or fined. A failure keeps what is shown; the next refresh tries again.
  const refresh = useCallback(async () => {
    try {
      const account = await api<Account>('/me');
      setState((current) => (current.status === 'ready' ? { status: 'ready', account } : current));
    } catch {
      // Nothing to do: the balance shown is at most one change behind.
    }
  }, []);

  return { state, retry, refresh };
}
