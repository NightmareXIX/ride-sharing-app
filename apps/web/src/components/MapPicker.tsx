'use client';

import dynamic from 'next/dynamic';

export type { MapMarker, MapNearby, MapRoute, MapTesla, MarkerTone } from './MapPickerClient';

// Leaflet needs `window`, so the map is only ever rendered in the browser.
export const MapPicker = dynamic(() => import('./MapPickerClient'), {
  ssr: false,
  loading: () => (
    <div
      role="status"
      className="flex h-72 w-full items-center justify-center rounded-xl bg-slate-100 text-sm text-slate-500 ring-1 ring-slate-200 sm:h-80"
    >
      Loading the map…
    </div>
  ),
});
