'use client';

import 'leaflet/dist/leaflet.css';
import { CRS, divIcon, latLngBounds } from 'leaflet';
import { useEffect, useMemo } from 'react';
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import { DHAKA_CENTER, isInServiceArea, roundPoint, SERVICE_AREA, type LatLng } from '@/lib/geo';

export type MarkerTone = 'pickup' | 'destination' | 'driver' | 'draft';

export interface MapMarker {
  key: string;
  point: LatLng;
  label: string;
  tone: MarkerTone;
}

export interface MapPickerProps {
  markers: MapMarker[];
  // Points joined by a dashed line with an arrow into each, e.g. the stops still to come, in
  // order. The line shows the order only; it isn't the road.
  path?: LatLng[];
  // Called with a point inside Dhaka when the map is tapped. Leave out for a read-only map.
  onPick?: (point: LatLng) => void;
  label: string;
}

// Circle markers need no image files, so there are no Leaflet icon assets to bundle.
const TONE_COLOURS: Record<MarkerTone, string> = {
  pickup: '#059669',
  destination: '#dc2626',
  driver: '#0f172a',
  draft: '#2563eb',
};

const PATH_COLOUR = '#0f172a';

const DHAKA_BOUNDS = latLngBounds(
  [SERVICE_AREA.minLat, SERVICE_AREA.minLng],
  [SERVICE_AREA.maxLat, SERVICE_AREA.maxLng],
);

function PickOnTap({ onPick }: { onPick: (point: LatLng) => void }) {
  useMapEvents({
    click(event) {
      const point = roundPoint(event.latlng);
      if (isInServiceArea(point)) onPick(point);
    },
  });
  return null;
}

// A leg's angle on screen, in degrees clockwise from east. Web Mercator keeps angles, so
// every zoom gives the same one.
function screenAngle(from: LatLng, to: LatLng): number {
  const a = CRS.EPSG3857.latLngToPoint(from, 0);
  const b = CRS.EPSG3857.latLngToPoint(to, 0);
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

// An arrowhead centred on a stop, turned to the leg into it. Its tip stops just outside the
// stop's dot (radius 9, plus the border), so it looks the same at any zoom.
function arrowIcon(angle: number) {
  return divIcon({
    className: '',
    iconSize: [48, 48],
    iconAnchor: [24, 24],
    html: `<svg width="48" height="48" viewBox="-24 -24 48 48" aria-hidden="true" style="transform: rotate(${angle}deg)"><path d="M -12 0 L -22 -6 L -22 6 Z" fill="${PATH_COLOUR}" /></svg>`,
  });
}

// One arrow into each stop of the path, so its order reads at a glance.
function PathArrows({ path }: { path: LatLng[] }) {
  const key = path.map((p) => `${p.lat},${p.lng}`).join('|');
  const arrows = useMemo(
    () =>
      path.slice(1).flatMap((to, i) => {
        const from = path[i]!;
        if (from.lat === to.lat && from.lng === to.lng) return [];
        return [
          { key: `${i}:${to.lat},${to.lng}`, point: to, icon: arrowIcon(screenAngle(from, to)) },
        ];
      }),
    // Re-made only when the path's points change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return arrows.map((arrow) => (
    <Marker
      key={arrow.key}
      position={arrow.point}
      icon={arrow.icon}
      interactive={false}
      keyboard={false}
    />
  ));
}

// Keeps the markers in view when they change, e.g. after a quick pick far away.
function FollowMarkers({ markers }: { markers: MapMarker[] }) {
  const map = useMap();
  const key = markers.map((m) => `${m.key}:${m.point.lat},${m.point.lng}`).join('|');
  useEffect(() => {
    const points = markers.map((m) => m.point);
    if (points.length === 1) {
      map.panTo(points[0]!);
    } else if (points.length > 1) {
      map.fitBounds(latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
    }
    // Re-run only when the set of points changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

// An OpenStreetMap map of Dhaka with the required credit (NFR-24).
export default function MapPickerClient({ markers, path, onPick, label }: MapPickerProps) {
  const first = markers[0]?.point ?? DHAKA_CENTER;
  return (
    <div
      role="region"
      aria-label={label}
      className="overflow-hidden rounded-xl ring-1 ring-slate-200"
    >
      <MapContainer
        center={first}
        zoom={14}
        minZoom={11}
        maxBounds={DHAKA_BOUNDS.pad(0.1)}
        maxBoundsViscosity={1}
        scrollWheelZoom={false}
        className={`h-72 w-full sm:h-80 ${onPick ? 'cursor-crosshair' : ''}`}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {path && path.length > 1 && (
          <>
            <Polyline
              positions={path}
              pathOptions={{ color: PATH_COLOUR, weight: 3, opacity: 0.6, dashArray: '6 8' }}
            />
            <PathArrows path={path} />
          </>
        )}
        {markers.map((marker) => (
          <CircleMarker
            key={marker.key}
            center={marker.point}
            radius={9}
            pathOptions={{
              color: '#ffffff',
              weight: 3,
              fillColor: TONE_COLOURS[marker.tone],
              fillOpacity: 1,
            }}
          >
            <Tooltip direction="top" offset={[0, -8]} permanent>
              {marker.label}
            </Tooltip>
          </CircleMarker>
        ))}
        <FollowMarkers markers={markers} />
        {onPick && <PickOnTap onPick={onPick} />}
      </MapContainer>
    </div>
  );
}
