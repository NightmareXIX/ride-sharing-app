import express, { type Express } from 'express';
import helmet from 'helmet';
import type pg from 'pg';
import type { SessionConfig } from './auth/session.js';
import { createDb } from './db/client.js';
import { createDistanceService } from './geo/distance.js';
import type { RoutingConfig } from './geo/openRouteService.js';
import { errorHandler, notFoundHandler } from './http/middleware/errorHandler.js';
import { requestLogger } from './http/middleware/requestLogger.js';
import type { Logger } from './logger.js';
import { healthRouter } from './routes/health.js';
import { v1Router } from './routes/v1/index.js';

export interface AppDeps {
  logger: Logger;
  pool: pg.Pool;
  session: SessionConfig;
  routing: RoutingConfig;
}

// Builds the Express app without listening, so tests can mount it on a random port.
export function createApp({ logger, pool, session, routing }: AppDeps): Express {
  const app = express();

  // Render and the Next.js proxy sit in front of the API.
  app.set('trust proxy', true);
  app.use(requestLogger(logger));
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));

  app.use(healthRouter(pool));
  const db = createDb(pool);
  app.use('/api/v1', v1Router({ db, session, distance: createDistanceService(db, routing) }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
