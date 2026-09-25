export interface LatLng {
  lat: number;
  lng: number;
}

export interface Place extends LatLng {
  label: string;
}

// The Dhaka service area; mirrors apps/api/src/geo/serviceArea.ts. The API rejects
// points outside it, so the map doesn't let you pick one.
export const SERVICE_AREA = {
  minLat: 23.65,
  maxLat: 23.95,
  minLng: 90.3,
  maxLng: 90.55,
} as const;

export const DHAKA_CENTER: LatLng = { lat: 23.7925, lng: 90.4078 };

export function isInServiceArea({ lat, lng }: LatLng): boolean {
  return (
    lat >= SERVICE_AREA.minLat &&
    lat <= SERVICE_AREA.maxLat &&
    lng >= SERVICE_AREA.minLng &&
    lng <= SERVICE_AREA.maxLng
  );
}

// The API stores 6 decimal places (about 11 cm).
export function roundPoint({ lat, lng }: LatLng): LatLng {
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

// Straight-line km, only for describing points on screen. Fares use the API's distance.
export function straightLineKm(from: LatLng, to: LatLng): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const a =
    Math.sin(rad(to.lat - from.lat) / 2) ** 2 +
    Math.cos(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.sin(rad(to.lng - from.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

export function formatLatLng({ lat, lng }: LatLng): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
