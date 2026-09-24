import { Router } from 'express';
import { AppError } from '../../http/errors.js';
import { currentSession, requireAuth } from '../../http/middleware/auth.js';
import { getAccount } from '../../services/accounts.js';
import type { V1Deps } from './index.js';

export function meRouter({ db, session }: V1Deps): Router {
  const router = Router();

  // The signed-in user, their wallet balance and, for a driver, their Tesla.
  router.get('/', requireAuth(session.secret), async (req, res) => {
    const account = await getAccount(db, currentSession(req).userId);
    // A valid token for an account that no longer exists is treated as signed out.
    if (!account) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
    res.json(account);
  });

  return router;
}
