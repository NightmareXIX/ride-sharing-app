import { getJson, postJson, sendJson } from './accounts.js';
import type { TestServer } from './server.js';

// Story places (phase 2 quick picks). Mohakhali and Gulshan 1 are under 2 km from Banani
// in a straight line; Uttara is far outside any driver's radius there.
export const BANANI = { lat: 23.7937, lng: 90.4066, label: 'Banani Road 11' };
export const MOHAKHALI = { lat: 23.7781, lng: 90.405, label: 'Mohakhali' };
export const GULSHAN_1 = { lat: 23.7806, lng: 90.4163, label: 'Gulshan 1' };
export const UTTARA = { lat: 23.8759, lng: 90.3795, label: 'Uttara' };

export function tripFrom(pickup = BANANI, overrides: Record<string, unknown> = {}) {
  return {
    pickup,
    destination: pickup === MOHAKHALI ? BANANI : MOHAKHALI,
    seats: 1,
    rideOption: 'pool',
    paymentMethod: 'cash',
    ...overrides,
  };
}

export interface BookingBody {
  id: string;
  status: string;
  [key: string]: unknown;
}

async function expectStatus(res: Response, status: number): Promise<unknown> {
  if (res.status !== status) {
    throw new Error(`Expected ${status}, got ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// Puts the driver's Tesla at a place and online.
export async function goOnlineAt(
  server: TestServer,
  driver: string,
  place: { lat: number; lng: number } = BANANI,
): Promise<void> {
  const where = { lat: place.lat, lng: place.lng };
  await expectStatus(
    await sendJson(server, 'PUT', '/api/v1/driver/vehicle/location', where, driver),
    200,
  );
  await expectStatus(await postJson(server, '/api/v1/driver/vehicle/online', {}, driver), 200);
}

// A passenger's ride request; returns the booking.
export async function requestRide(
  server: TestServer,
  passenger: string,
  trip: unknown = tripFrom(),
): Promise<BookingBody> {
  const body = await expectStatus(await postJson(server, '/api/v1/bookings', trip, passenger), 201);
  return (body as { booking: BookingBody }).booking;
}

export function acceptRequest(server: TestServer, driver: string, bookingId: string) {
  return postJson(server, `/api/v1/driver/requests/${bookingId}/accept`, {}, driver);
}

export function driverAction(
  server: TestServer,
  driver: string,
  bookingId: string,
  action: 'arrive' | 'start' | 'complete' | 'cancel',
) {
  return postJson(server, `/api/v1/driver/bookings/${bookingId}/${action}`, {}, driver);
}

export async function nearbyRequestIds(server: TestServer, driver: string): Promise<string[]> {
  const body = await expectStatus(await getJson(server, '/api/v1/driver/requests', driver), 200);
  return (body as { requests: Array<{ id: string }> }).requests.map((r) => r.id);
}

export async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}
