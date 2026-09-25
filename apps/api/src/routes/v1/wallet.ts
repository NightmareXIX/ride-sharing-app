import { Router } from 'express';
import { z } from 'zod';
import { topUpProblem } from '../../domain/wallet.js';
import { currentSession, requireAuth, requireRole } from '../../http/middleware/auth.js';
import { parsePageQuery } from '../../http/pagination.js';
import { getWallet, listTransactions, topUp } from '../../services/wallet.js';
import type { V1Deps } from './index.js';

// Money is sent as text, e.g. "500.00", never as a float (API Routes §1).
const topUpBody = z.object({
  id: z.uuid('must be a UUID'),
  amount: z.string('must be text such as "500.00"').superRefine((amount, ctx) => {
    const problem = topUpProblem(amount);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  }),
});

// Everyone's TeslaPay wallet (API Routes §4). Each user sees only their own (NFR-8).
export function walletRouter({ db, session }: V1Deps): Router {
  const router = Router();
  router.use(requireAuth(session.secret));

  router.get('/', async (req, res) => {
    res.json({ wallet: await getWallet(db, currentSession(req).userId) });
  });

  // Every money movement, newest first, in pages (FR-W8, NFR-36).
  router.get('/transactions', async (req, res) => {
    const page = parsePageQuery(req.query);
    const { items, nextCursor } = await listTransactions(db, currentSession(req).userId, page);
    res.json({ transactions: items, nextCursor });
  });

  // Pretend money, for passengers only (FR-W2). A repeated submit returns the top-up it
  // already made (NFR-37).
  router.post('/top-ups', requireRole('passenger'), async (req, res) => {
    const body = topUpBody.parse(req.body);
    const { transaction, wallet, created } = await topUp(db, currentSession(req).userId, body);
    res.status(created ? 201 : 200).json({ transaction, wallet });
  });

  return router;
}
