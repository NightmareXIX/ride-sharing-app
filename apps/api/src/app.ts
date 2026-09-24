import express, { type Express } from 'express';
import helmet from 'helmet';
import { requestLogger } from './http/middleware/requestLogger.js';
import type { Logger } from './logger.js';
import { healthRouter } from './routes/health.js';
import { v1Router } from './routes/v1/index.js';

export interface AppDeps {
  logger: Logger;
}

// Builds the Express app without listening, so tests can mount it on a random port.
export function createApp({ logger }: AppDeps): Express {
  const app = express();

  // Render and the Next.js proxy sit in front of the API.
  app.set('trust proxy', true);
  app.use(requestLogger(logger));
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));

  app.use(healthRouter());
  app.use('/api/v1', v1Router());

  return app;
}
