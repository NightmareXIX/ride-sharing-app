// A Tesla's seats, kept free of I/O so the rule is easy to test (NFR-26). The database
// enforces the same limit with a conditional update and a CHECK (FR-C1); this decides
// what the driver is shown and why an accept was refused.

export function freeSeats(capacity: number, occupied: number): number {
  return Math.max(capacity - occupied, 0);
}

// Whether a booking for `seats` fits in what's left (FR-R2).
export function fitsFreeSeats(capacity: number, occupied: number, seats: number): boolean {
  return seats <= freeSeats(capacity, occupied);
}
