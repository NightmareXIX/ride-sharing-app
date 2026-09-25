// The app serves Dhaka only: a box from Uttara in the north to Old Dhaka in the south.
// It keeps road distances sensible and saves map-service quota (phase 2 LLD §3).
export const SERVICE_AREA = {
  minLat: 23.65,
  maxLat: 23.95,
  minLng: 90.3,
  maxLng: 90.55,
} as const;

export interface LatLng {
  lat: number;
  lng: number;
}
