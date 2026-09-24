import { Router, type Response } from 'express';
import { z } from 'zod';
import { MAX_PASSWORD_BYTES } from '../../auth/password.js';
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
  type Session,
  type SessionConfig,
} from '../../auth/session.js';
import { gender, MAX_VEHICLE_CAPACITY } from '../../db/schema/index.js';
import { signUp } from '../../services/accounts.js';
import type { V1Deps } from './index.js';

// Stored lowercased, so the same address in any case is one account.
const email = z.string().trim().toLowerCase().pipe(z.email('must be a valid email address'));

const password = z
  .string()
  .min(8, 'must be at least 8 characters')
  .refine((value) => Buffer.byteLength(value) <= MAX_PASSWORD_BYTES, 'is too long');

const accountFields = {
  name: z.string().trim().min(1, 'is required').max(80, 'must be at most 80 characters'),
  email,
  password,
  // Required at sign-up because the same-gender pool depends on it (FR-P1).
  gender: z.enum(gender.enumValues, 'must be female or male'),
};

const signUpSchema = z.discriminatedUnion(
  'role',
  [
    z.object({
      role: z.literal('passenger'),
      ...accountFields,
      vehicle: z.undefined('only drivers register a Tesla').optional(),
    }),
    z.object({
      role: z.literal('driver'),
      ...accountFields,
      // A driver registers exactly one Tesla when signing up (FR-D1).
      vehicle: z.object(
        {
          name: z.string().trim().min(1, 'is required').max(40, 'must be at most 40 characters'),
          capacity: z
            .int('must be a whole number')
            .min(1, 'must be at least 1')
            .max(MAX_VEHICLE_CAPACITY, `must be at most ${MAX_VEHICLE_CAPACITY}`),
        },
        'drivers must register their Tesla',
      ),
    }),
  ],
  { error: 'must be passenger or driver' },
);

async function startSession(res: Response, session: Session, config: SessionConfig) {
  const token = await signSession(session, config.secret);
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(config.secure));
}

export function authRouter({ db, session }: V1Deps): Router {
  const router = Router();

  // Creates the account and signs the new user straight in.
  router.post('/signup', async (req, res) => {
    const account = await signUp(db, signUpSchema.parse(req.body));
    await startSession(res, { userId: account.user.id, role: account.user.role }, session);
    res.status(201).json(account);
  });

  return router;
}
