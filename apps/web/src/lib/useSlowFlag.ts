'use client';

import { useEffect, useState } from 'react';

// True once `active` has stayed true for `afterMs`, e.g. to say "Calculating route…"
// when the map service takes more than 3 seconds (NFR-2).
export function useSlowFlag(active: boolean, afterMs = 3_000): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setSlow(true), afterMs);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [active, afterMs]);
  return active && slow;
}
