import { createApp } from './app.js';
import { loadConfig, type Config } from './config.js';
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
const app = createApp({ logger });

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
    if (err) {
      logger.error({ err }, 'Error while closing the HTTP server');
      process.exit(1);
    }
    logger.info('Shutdown complete');
    process.exit(0);
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
