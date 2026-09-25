import { straightLineKm, formatLatLng, type LatLng, type Place } from './geo';

// Well-known spots, for choosing a point without the map. Coordinates are approximate.
export const QUICK_PICKS: readonly Place[] = [
  { label: 'Banani Road 11', lat: 23.7937, lng: 90.4066 },
  // Wireless Gate, where the road to Gulshan 1 begins, so the story's two rides can share.
  { label: 'Mohakhali', lat: 23.7812, lng: 90.409 },
  { label: 'Gulshan 1', lat: 23.7806, lng: 90.4163 },
  { label: 'Dhanmondi 27', lat: 23.7561, lng: 90.374 },
  { label: 'Farmgate', lat: 23.7577, lng: 90.3897 },
  { label: 'Mirpur 10', lat: 23.8069, lng: 90.3687 },
  { label: 'Bashundhara R/A', lat: 23.819, lng: 90.4526 },
  { label: 'Uttara Sector 7', lat: 23.871, lng: 90.398 },
];

// "Near Gulshan 1" when a quick pick is close by, otherwise the coordinates.
export function describePoint(point: LatLng): string {
  let nearest: Place | undefined;
  let nearestKm = Infinity;
  for (const place of QUICK_PICKS) {
    const km = straightLineKm(point, place);
    if (km < nearestKm) {
      nearest = place;
      nearestKm = km;
    }
  }
  if (!nearest || nearestKm > 0.6) return formatLatLng(point);
  return nearestKm < 0.05 ? nearest.label : `Near ${nearest.label}`;
}
