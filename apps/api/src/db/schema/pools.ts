import { sql } from 'drizzle-orm';
import { check, pgEnum, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { vehicles } from './vehicles.js';

export const poolStatus = pgEnum('pool_status', ['active', 'finished']);

// One continuous trip by one Tesla, grouping every booking it serves (Core Entities: Pool).
// It finishes once none of its bookings is still active (FR-R7).
export const pools = pgTable(
  'pools',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    status: poolStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    check('pools_finished_at', sql`(${t.status} = 'finished') = (${t.finishedAt} IS NOT NULL)`),
    // A Tesla runs one trip at a time. The database backstop for accepting (FR-C1–C3).
    uniqueIndex('pools_one_active_per_vehicle')
      .on(t.vehicleId)
      .where(sql`${t.status} = 'active'`),
  ],
);

export type Pool = typeof pools.$inferSelect;
