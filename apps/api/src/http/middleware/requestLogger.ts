import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { pinoHttp } from 'pino-http';
import type { Logger } from '../../logger.js';

export const REQUEST_ID_HEADER = 'X-Request-Id';

// An upstream id (e.g. from the Next.js proxy) is kept only if it looks like an id,
// so a client can't inject arbitrary text into our logs.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

function isHealthCheck(req: IncomingMessage): boolean {
  return req.url === '/health' || req.url === '/health/ready';
}

// Logs every request with a unique id, the route, the result and how long it took, and
// echoes the id back so a problem can be traced (NFR-42). Failures are warnings or
// errors (NFR-44); passing health probes drop to debug so they don't drown the log.
export function requestLogger(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId(req, res) {
      const incoming = req.headers[REQUEST_ID_HEADER.toLowerCase()];
      const id =
        typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
      res.setHeader(REQUEST_ID_HEADER, id);
      return id;
    },
    // Keep entries short; headers (and so cookies) are never logged.
    serializers: {
      req: (req: { id: string; method: string; url: string }) => ({
        id: req.id,
        method: req.method,
        url: req.url,
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
    customLogLevel(req, res, err) {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      if (isHealthCheck(req)) return 'debug';
      return 'info';
    },
  });
}
