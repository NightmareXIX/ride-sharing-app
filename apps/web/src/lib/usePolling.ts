'use client';

import { useEffect, useRef } from 'react';

// Runs `poll` every `intervalMs`, counted from when the previous call finished, so slow
// calls never pile up (NFR-3). Skips while the tab is hidden. `poll` handles its own errors.
export function usePolling(poll: () => Promise<void>, enabled: boolean, intervalMs = 4_000) {
  const latest = useRef(poll);
  useEffect(() => {
    latest.current = poll;
  });

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState !== 'hidden') await latest.current();
      if (!stopped) timer = setTimeout(tick, intervalMs);
    };
    timer = setTimeout(tick, intervalMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [enabled, intervalMs]);
}
