import type { LatLng } from './geo';

// The body of GET /driver/vehicle and the availability routes.
export interface DriverVehicle {
  id: string;
  name: string;
  capacity: number;
  // Seats held by the passengers aboard or on their way.
  occupiedSeats: number;
  isOnline: boolean;
  location: LatLng | null;
  // Late cancels recorded against the driver.
  penaltyCount: number;
}
