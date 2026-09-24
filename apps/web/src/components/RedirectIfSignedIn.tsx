'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { homePath, type Account } from '@/lib/account';
import { api } from '@/lib/api';

// On public pages, a visitor who is already signed in goes straight to their home.
// Asks the server rather than trusting the cookie, which may have expired.
export function RedirectIfSignedIn() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    api<Account>('/me').then(
      (account) => {
        if (!cancelled) router.replace(homePath(account.user.role));
      },
      () => {
        // Not signed in (or the server is unreachable): stay on this page.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [router]);
  return null;
}
