'use client';

import { useEffect, useState } from 'react';
import { api } from './api';
import type { LatLng } from './geo';
import type { NearbyTeslas } from './nearby';
import { usePolling } from './usePolling';

interface Found {
  at: LatLng;
  nearby: NearbyTeslas;
}

function readNearby(at: LatLng): Promise<Found> {
  return api<NearbyTeslas>(`/nearby-teslas?lat=${at.lat}&lng=${at.lng}`).then((nearby) => ({
    at,
    nearby,
  }));
}

// The Teslas near the pickup: read as soon as it is set or moved, then every 4 seconds
// (NFR-3). Null until the first reply for this pickup; a reply for an earlier one is never
// shown. A failed read keeps the last result, since a ride can be requested without it.
export function useNearbyTeslas(pickup: LatLng | null): NearbyTeslas | null {
  const lat = pickup?.lat;
  const lng = pickup?.lng;
  const [found, setFound] = useState<Found | null>(null);

  useEffect(() => {
    if (lat === undefined || lng === undefined) return;
    let current = true;
    readNearby({ lat, lng }).then(
      (next) => current && setFound(next),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [lat, lng]);

  usePolling(async () => {
    if (lat === undefined || lng === undefined) return;
    await readNearby({ lat, lng }).then(setFound, () => {});
  }, lat !== undefined);

  return found && found.at.lat === lat && found.at.lng === lng ? found.nearby : null;
}
