import type { LatLng } from './geo';

// The body of GET /driver/vehicle and the availability routes.
export interface DriverVehicle {
  id: string;
  name: string;
  capacity: number;
  isOnline: boolean;
  location: LatLng | null;
}
