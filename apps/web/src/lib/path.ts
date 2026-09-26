'use client';

import { useEffect, useState } from 'react';
import { api } from './api';
import type { DistanceMethod } from './booking';

// A point on a drawn road, [lat, lng].
export type PathPoint = [number, number];

// The road from one point to the next, for drawing only (route-paths LLD §3). A fallback
// leg is a straight line: the map service couldn't answer (NFR-13).
export interface PathLeg {
  method: DistanceMethod;
  points: PathPoint[];
  // On the driver's route: the stop the leg ends at.
  toStopId?: string;
}

export interface RoutePath {
  legs: PathLeg[];
}

// Some of the road is a straight line, so the map should say it's approximate.
export function isApproximate(legs: readonly PathLeg[]): boolean {
  return legs.some((leg) => leg.method === 'fallback');
}

interface Loaded {
  key: string;
  legs: PathLeg[];
}

// A road route read once for each `path` and `version`, never polled: the road only changes
// when what it goes through does. Null while it loads, when `path` is null, or if it
// fails, so the map keeps its plainer line. A reply for an earlier key is never shown.
export function usePath(path: string | null, version = ''): PathLeg[] | null {
  const key = path === null ? null : `${path}#${version}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (path === null || key === null) return;
    let current = true;
    api<RoutePath>(path).then(
      (body) => current && setLoaded({ key, legs: body.legs }),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [path, key]);

  return loaded && loaded.key === key ? loaded.legs : null;
}
