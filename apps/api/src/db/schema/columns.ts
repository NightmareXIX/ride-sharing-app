import { numeric } from 'drizzle-orm/pg-core';

// A coordinate to 6 decimal places (about 11 cm). Not money, so it can be a number.
export function coordinate(name: string) {
  return numeric(name, { precision: 9, scale: 6, mode: 'number' });
}
