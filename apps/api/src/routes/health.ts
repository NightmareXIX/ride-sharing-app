import { Router } from 'express';
import type pg from 'pg';

const READINESS_TIMEOUT_MS = 2_000;

async function pingDatabase(pool: pg.Pool): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Database did not answer within ${READINESS_TIMEOUT_MS} ms`)),
      READINESS_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([pool.query('SELECT 1'), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Health checks live outside /api/v1 so hosting platforms can probe them (NFR-15).
export function healthRouter(pool: pg.Pool): Router {
  const router = Router();

  // Liveness: the process is up and serving requests.
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Readiness: the process can also reach the database.
  router.get('/health/ready', async (_req, res) => {
    try {
      await pingDatabase(pool);
      res.json({ status: 'ok', database: 'up' });
    } catch (err) {
      // pino-http logs the 503 with this cause attached.
      res.err = err instanceof Error ? err : new Error(String(err));
      res.status(503).json({ status: 'unavailable', database: 'down' });
    }
  });

  return router;
}
