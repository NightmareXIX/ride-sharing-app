import { Router } from 'express';

// Every product route is mounted under /api/v1 (NFR-34). Feature phases add their routers here.
export function v1Router(): Router {
  const router = Router();
  return router;
}
