import type { Booking } from './booking';

// The body of GET /me, and of a successful sign-up or sign-in.
export type Role = 'passenger' | 'driver';
export type Gender = 'female' | 'male';

export interface Account {
  user: {
    id: string;
    name: string;
    email: string;
    gender: Gender;
    role: Role;
    createdAt: string;
  };
  // Money arrives as a string such as "0.00", never a number.
  wallet: { balance: string };
  vehicle: { id: string; name: string; capacity: number } | null;
  // The passenger's active ride, if any. Always null for a driver.
  currentBooking: Booking | null;
}

export function homePath(role: Role): string {
  return `/${role}`;
}
