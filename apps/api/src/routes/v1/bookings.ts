import { Router } from 'express';
import { z } from 'zod';
import { PAYMENT_METHODS } from '../../domain/booking.js';
import { AppError } from '../../http/errors.js';
import { currentSession, requireAuth, requireRole } from '../../http/middleware/auth.js';
import { cancelRide, getBooking, getCurrentBooking, requestRide } from '../../services/bookings.js';
import type { V1Deps } from './index.js';
import { trip, uuidParam } from './schemas.js';

const rideRequest = trip.and(
  z.object({ paymentMethod: z.enum(PAYMENT_METHODS, 'must be cash or teslapay') }),
);

// An id that isn't a UUID can't be anyone's booking, so it is simply not found.
function bookingId(raw: string): string {
  const parsed = uuidParam.safeParse(raw);
  if (!parsed.success) throw new AppError(404, 'NOT_FOUND', 'This ride was not found.');
  return parsed.data;
}

// A passenger's own ride requests (API Routes §5). Passengers only (NFR-8).
export function bookingsRouter(deps: V1Deps): Router {
  const { db, session } = deps;
  const router = Router();
  router.use(requireAuth(session.secret), requireRole('passenger'));

  router.post('/', async (req, res) => {
    const input = rideRequest.parse(req.body);
    const { booking, created } = await requestRide(
      deps,
      req.log,
      currentSession(req).userId,
      input,
    );
    // A repeated tap gets the booking it already made (NFR-37).
    res.status(created ? 201 : 200).json({ booking });
  });

  // Polled every 4 seconds by the passenger's screen (NFR-3).
  router.get('/current', async (req, res) => {
    res.json({ booking: await getCurrentBooking(db, currentSession(req).userId) });
  });

  router.get('/:id', async (req, res) => {
    const booking = await getBooking(db, currentSession(req).userId, bookingId(req.params.id));
    res.json({ booking });
  });

  router.post('/:id/cancel', async (req, res) => {
    const booking = await cancelRide(db, currentSession(req).userId, bookingId(req.params.id));
    res.json({ booking });
  });

  return router;
}
