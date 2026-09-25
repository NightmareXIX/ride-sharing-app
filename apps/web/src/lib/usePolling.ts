'use client';

import { useEffect, useRef } from 'react';

// Runs `poll` every `intervalMs`, counted from when the previous call finished, so slow
// calls never pile up (NFR-3). Skips while the tab is hidden. `poll` handles its own errors.
// With `immediate`, the first call runs as soon as polling is enabled.
export function usePolling(
  poll: () => Promise<void>,
  enabled: boolean,
  { intervalMs = 4_000, immediate = false }: { intervalMs?: number; immediate?: boolean } = {},
) {
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
    timer = setTimeout(tick, immediate ? 0 : intervalMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [enabled, intervalMs, immediate]);
}
