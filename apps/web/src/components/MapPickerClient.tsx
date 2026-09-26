'use client';

import 'leaflet/dist/leaflet.css';
import { CRS, divIcon, latLngBounds, type CircleMarker as LeafletCircleMarker } from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  Pane,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import { DHAKA_CENTER, isInServiceArea, roundPoint, SERVICE_AREA, type LatLng } from '@/lib/geo';
import type { PathLeg } from '@/lib/path';

export type MarkerTone = 'pickup' | 'destination' | 'draft' | 'preview';

export interface MapMarker {
  key: string;
  point: LatLng;
  label: string;
  tone: MarkerTone;
  // Done with, e.g. a stop already reached: drawn faint, labelled only on hover.
  faded?: boolean;
}

export interface MapTesla {
  point: LatLng;
  label: string;
}

// Teslas near a point, with the circle they were looked for in. Only for looking: they
// can't be tapped, and the map doesn't move to follow them.
export interface MapNearby {
  center: LatLng;
  radiusKm: number;
  teslas: LatLng[];
}

// A road route (route-paths LLD §4). `trip` is the viewer's own: the passenger's trip or
// the driver's route. `preview` is a request the driver is looking at, drawn over it.
export interface MapRoute {
  key: string;
  tone: 'trip' | 'preview';
  legs: PathLeg[];
}

export interface MapPickerProps {
  markers: MapMarker[];
  routes?: MapRoute[];
  nearby?: MapNearby;
  // The driver's Tesla, drawn above everything else. It glides when its point changes.
  tesla?: MapTesla;
  // Points joined by a dashed line with an arrow into each, e.g. the stops still to come, in
  // order. The line shows the order only; it isn't the road. Shown until the road arrives.
  path?: LatLng[];
  // Called with a point inside Dhaka when the map is tapped. Leave out for a read-only map.
  onPick?: (point: LatLng) => void;
  label: string;
}

// Circle markers need no image files, so there are no Leaflet icon assets to bundle.
const TONE_COLOURS: Record<MarkerTone, string> = {
  pickup: '#059669',
  destination: '#dc2626',
  draft: '#2563eb',
  // A request's destination, shown before accepting: not one of the trip's drop-offs.
  preview: '#7c3aed',
};

const PATH_COLOUR = '#0f172a';
const PREVIEW_COLOUR = TONE_COLOURS.preview;
const TESLA_COLOUR = '#0f172a';

// Long enough to follow, short enough not to wait for.
const GLIDE_MS = 700;

// About 30 m in degrees: how far back along a road its last stretch is measured from.
const LAST_STRETCH = 0.0003;

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

interface Arrow {
  key: string;
  point: LatLng;
  // Where the line comes into the point from, which sets the arrow's angle.
  from: LatLng;
}

// Stop-order legs: one straight line from each point to the next.
function straightArrows(path: readonly LatLng[]): Arrow[] {
  return path.slice(1).flatMap((to, i) => {
    const from = path[i]!;
    if (from.lat === to.lat && from.lng === to.lng) return [];
    return [{ key: `${i}:${to.lat},${to.lng}`, point: to, from }];
  });
}

// The point a road comes into its end from. Its last few metres can run any way, since the
// line is joined to the stop's exact point, so a point a little way back is used.
function approach(points: readonly LatLng[]): LatLng | undefined {
  const end = points.at(-1);
  if (!end) return undefined;
  for (let i = points.length - 2; i >= 0; i -= 1) {
    const point = points[i]!;
    if (Math.hypot(point.lat - end.lat, point.lng - end.lng) >= LAST_STRETCH) return point;
  }
  return points.find((point) => point.lat !== end.lat || point.lng !== end.lng);
}

function toLatLngs(leg: PathLeg): LatLng[] {
  return leg.points.map(([lat, lng]) => ({ lat, lng }));
}

// Road legs: each arrow is turned to the last stretch of road into its stop.
function roadArrows(legs: readonly PathLeg[]): Arrow[] {
  return legs.flatMap((leg, i) => {
    const points = toLatLngs(leg);
    const to = points.at(-1);
    const from = approach(points);
    return to && from ? [{ key: `${i}:${to.lat},${to.lng}`, point: to, from }] : [];
  });
}

// One arrow into each stop, so the route's order reads at a glance.
function Arrows({ arrows: given }: { arrows: Arrow[] }) {
  const key = given.map((a) => `${a.key}<${a.from.lat},${a.from.lng}`).join('|');
  const arrows = useMemo(
    () => given.map((a) => ({ ...a, icon: arrowIcon(screenAngle(a.from, a.point)) })),
    // Re-made only when the arrows' points change.
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

// Road routes, below the stops and the Tesla and above the nearby Teslas. The viewer's own
// route is a dark line on a white casing. A preview is a thinner violet line on top, so a
// road the two share reads as violet inside dark, and a stretch where it leaves the route
// shows on its own. Fallback legs are thin straight dashes, like the stop-order line.
function RouteLayer({ routes }: { routes: MapRoute[] }) {
  // Own routes first, so a preview is drawn over them.
  const ordered = [...routes].sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'trip' ? -1 : 1));
  return (
    <Pane name="routes" style={{ zIndex: 380 }}>
      {ordered.flatMap((route) =>
        route.legs.flatMap((leg, i) => {
          const key = `${route.key}:${i}`;
          const positions = toLatLngs(leg);
          const colour = route.tone === 'trip' ? PATH_COLOUR : PREVIEW_COLOUR;
          if (leg.method === 'fallback') {
            return [
              <Polyline
                key={key}
                positions={positions}
                interactive={false}
                pathOptions={{ color: colour, weight: 3, opacity: 0.7, dashArray: '6 8' }}
              />,
            ];
          }
          if (route.tone === 'preview') {
            return [
              <Polyline
                key={key}
                positions={positions}
                interactive={false}
                pathOptions={{ color: colour, weight: 3.5, opacity: 0.95, lineJoin: 'round' }}
              />,
            ];
          }
          return [
            <Polyline
              key={`${key}:casing`}
              positions={positions}
              interactive={false}
              pathOptions={{ color: '#ffffff', weight: 10, opacity: 0.9, lineJoin: 'round' }}
            />,
            <Polyline
              key={key}
              positions={positions}
              interactive={false}
              pathOptions={{ color: colour, weight: 6, opacity: 0.8, lineJoin: 'round' }}
            />,
          ];
        }),
      )}
    </Pane>
  );
}

// The corners of the box around the routes, so the map can keep all of them in view.
function routeCorners(routes: readonly MapRoute[]): LatLng[] {
  const points = routes.flatMap((route) => route.legs.flatMap((leg) => leg.points));
  if (points.length === 0) return [];
  const lats = points.map(([lat]) => lat);
  const lngs = points.map(([, lng]) => lng);
  return [
    { lat: Math.min(...lats), lng: Math.min(...lngs) },
    { lat: Math.max(...lats), lng: Math.max(...lngs) },
  ];
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

// The Tesla, in its own pane above the stops and arrows. It glides in a straight line to a
// new point, starting from wherever it is, even mid-glide. It doesn't glide when the map
// opens, and jumps straight there when the device asks for less motion.
function MovingTesla({ point, label }: MapTesla) {
  const dot = useRef<LeafletCircleMarker>(null);
  // react-leaflet would jump a marker whose centre prop changes, so it gets the first point
  // only and is moved here.
  const [first] = useState(point);
  const { lat, lng } = point;
  useEffect(() => {
    const marker = dot.current;
    if (!marker) return;
    const from = marker.getLatLng();
    if (from.lat === lat && from.lng === lng) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      marker.setLatLng([lat, lng]);
      return;
    }
    const began = performance.now();
    let frame = requestAnimationFrame(function glide(now) {
      const t = easeInOut(Math.min((now - began) / GLIDE_MS, 1));
      marker.setLatLng([from.lat + (lat - from.lat) * t, from.lng + (lng - from.lng) * t]);
      if (t < 1) frame = requestAnimationFrame(glide);
    });
    return () => cancelAnimationFrame(frame);
  }, [lat, lng]);
  return (
    // Above the arrows (600), below the labels (650).
    <Pane name="tesla" style={{ zIndex: 620 }}>
      <CircleMarker
        ref={dot}
        center={first}
        radius={11}
        pathOptions={{ color: '#ffffff', weight: 3, fillColor: TESLA_COLOUR, fillOpacity: 1 }}
      >
        <Tooltip pane="tooltipPane" direction="bottom" offset={[0, 10]} permanent>
          {label}
        </Tooltip>
      </CircleMarker>
    </Pane>
  );
}

// Below the path and stops (overlay 400), so a Tesla never hides the pickup. Not
// interactive, so a tap on a Tesla sets a stop there like anywhere else.
function NearbyLayer({ center, radiusKm, teslas }: MapNearby) {
  return (
    <Pane name="nearby" style={{ zIndex: 350 }}>
      <Circle
        center={center}
        radius={radiusKm * 1000}
        interactive={false}
        pathOptions={{
          color: TESLA_COLOUR,
          weight: 2,
          opacity: 0.6,
          dashArray: '4 6',
          fillColor: TESLA_COLOUR,
          fillOpacity: 0.07,
        }}
      />
      {teslas.map((point, i) => (
        <CircleMarker
          // Two Teslas can round to one point.
          key={`${i}:${point.lat},${point.lng}`}
          center={point}
          radius={6}
          interactive={false}
          pathOptions={{ color: '#ffffff', weight: 2, fillColor: TESLA_COLOUR, fillOpacity: 0.85 }}
        />
      ))}
    </Pane>
  );
}

// Keeps the points in view when they change, e.g. after a quick pick far away.
function FollowPoints({ points }: { points: LatLng[] }) {
  const map = useMap();
  const key = points.map((p) => `${p.lat},${p.lng}`).join('|');
  useEffect(() => {
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
export default function MapPickerClient({
  markers,
  routes = [],
  nearby,
  tesla,
  path,
  onPick,
  label,
}: MapPickerProps) {
  const points = [...(tesla ? [tesla.point] : []), ...markers.map((m) => m.point)];
  const first = points[0] ?? DHAKA_CENTER;
  // A road can bulge past its stops, so the whole road is kept in view too.
  const inView = [...points, ...routeCorners(routes)];
  // The driver's route has an arrow into each stop, as the stop-order line does.
  const trip = tesla ? routes.find((route) => route.tone === 'trip') : undefined;
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
        {nearby && <NearbyLayer {...nearby} />}
        {routes.length > 0 && <RouteLayer routes={routes} />}
        {path && path.length > 1 && (
          <>
            <Polyline
              positions={path}
              pathOptions={{ color: PATH_COLOUR, weight: 3, opacity: 0.6, dashArray: '6 8' }}
            />
            <Arrows arrows={straightArrows(path)} />
          </>
        )}
        {trip && <Arrows arrows={roadArrows(trip.legs)} />}
        {markers.map((marker) => (
          <CircleMarker
            // A tooltip can't stop being permanent, so fading draws the marker afresh.
            key={`${marker.key}${marker.faded ? ':faded' : ''}`}
            center={marker.point}
            radius={9}
            pathOptions={{
              color: '#ffffff',
              weight: 3,
              fillColor: TONE_COLOURS[marker.tone],
              fillOpacity: marker.faded ? 0.35 : 1,
            }}
          >
            <Tooltip direction="top" offset={[0, -8]} permanent={!marker.faded}>
              {marker.label}
            </Tooltip>
          </CircleMarker>
        ))}
        {tesla && <MovingTesla point={tesla.point} label={tesla.label} />}
        <FollowPoints points={inView} />
        {onPick && <PickOnTap onPick={onPick} />}
      </MapContainer>
    </div>
  );
}
