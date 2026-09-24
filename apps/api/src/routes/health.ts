import { Router } from 'express';

// Health checks live outside /api/v1 so hosting platforms can probe them (NFR-15).
export function healthRouter(): Router {
  const router = Router();

  // Liveness: the process is up and serving requests.
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  return router;
}
