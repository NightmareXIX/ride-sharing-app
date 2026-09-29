'use client';

import { useEffect, useState } from 'react';

// The API and database sleep on free hosting, so the first request after a quiet spell
// can take up to a minute. Says so, but only when the server is actually slow to answer.
const SLOW_AFTER_MS = 2_000;
const RETRY_EVERY_MS = 3_000;
const GIVE_UP_AFTER_MS = 90_000;
const READY_FOR_MS = 2_000;

type Phase = 'checking' | 'waking' | 'ready' | 'done';

export function ColdStartNotice() {
  const [phase, setPhase] = useState<Phase>('checking');

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const slowTimer = setTimeout(() => setPhase('waking'), SLOW_AFTER_MS);
    // Past this the server is down rather than asleep; the app's own errors take over.
    const giveUpTimer = setTimeout(() => {
      controller.abort();
      setPhase('done');
    }, GIVE_UP_AFTER_MS);

    // A proxy error while the API boots is not an answer, so keep asking.
    async function waitUntilReady(): Promise<boolean> {
      while (!signal.aborted) {
        try {
          const res = await fetch('/api/health', { cache: 'no-store', signal });
          if (res.ok) return true;
        } catch {
          // Unreachable or aborted: the loop condition decides.
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_EVERY_MS));
      }
      return false;
    }

    void waitUntilReady().then((ready) => {
      if (!ready || signal.aborted) return;
      clearTimeout(slowTimer);
      clearTimeout(giveUpTimer);
      setPhase((current) => (current === 'waking' ? 'ready' : 'done'));
    });

    return () => {
      controller.abort();
      clearTimeout(slowTimer);
      clearTimeout(giveUpTimer);
    };
  }, []);

  useEffect(() => {
    if (phase !== 'ready') return;
    const timer = setTimeout(() => setPhase('done'), READY_FOR_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const visible = phase === 'waking' || phase === 'ready';

  // The live region is always present so screen readers announce the notice when it fills.
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-4 top-4 z-[1000] mx-auto max-w-xl"
    >
      {visible && (
        <div className="pointer-events-auto flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-md">
          <div className="flex-1">
            <p className="font-medium text-slate-900">
              {phase === 'waking' ? 'Waking the server up…' : 'Server is ready.'}
            </p>
            {phase === 'waking' && (
              <p className="mt-0.5">
                We run on free hosting, so the first load after a quiet spell can take up to a
                minute. Thanks for waiting.
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setPhase('done')}
            className="-m-1.5 rounded-md p-1.5 text-slate-500 transition hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="size-4"
            >
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
