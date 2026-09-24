import { createApp } from './app.js';
import { loadConfig, type Config } from './config.js';
import { createPool } from './db/client.js';
import { createLogger } from './logger.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const logger = createLogger(config);
const pool = createPool(config.DATABASE_URL, logger);
const app = createApp({
  logger,
  pool,
  session: { secret: config.SESSION_SECRET, secure: config.COOKIE_SECURE },
});

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'API listening');
});

// Finish in-flight requests before exiting (NFR-16).
let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down: waiting for in-flight requests');

  setTimeout(() => {
    logger.error('Shutdown timed out; forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  server.close((err) => {
    if (err) logger.error({ err }, 'Error while closing the HTTP server');
    // Only release database connections once no request can still need one.
    pool.end().then(
      () => {
        logger.info('Shutdown complete');
        process.exit(err ? 1 : 0);
      },
      (poolErr: unknown) => {
        logger.error({ err: poolErr }, 'Error while closing the database pool');
        process.exit(1);
      },
    );
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Crashes are logged with full details before the process exits (NFR-44).
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  process.exit(1);
});
