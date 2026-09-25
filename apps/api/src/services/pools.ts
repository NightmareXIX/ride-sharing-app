import { and, eq } from 'drizzle-orm';
import type { Database, Transaction } from '../db/client.js';
import { pools } from '../db/schema/index.js';

// The Tesla's trip in progress, if any. There is at most one (pools_one_active_per_vehicle).
export async function activePoolId(
  db: Database | Transaction,
  vehicleId: string,
): Promise<string | null> {
  const [pool] = await db
    .select({ id: pools.id })
    .from(pools)
    .where(and(eq(pools.vehicleId, vehicleId), eq(pools.status, 'active')));
  return pool?.id ?? null;
}
