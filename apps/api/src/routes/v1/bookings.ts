import { Router } from 'express';
import { z } from 'zod';
import { PAYMENT_METHODS } from '../../domain/booking.js';
import { currentSession, requireAuth, requireRole } from '../../http/middleware/auth.js';
import { parsePageQuery } from '../../http/pagination.js';
import {
  cancelRide,
  getBooking,
  getCurrentBooking,
  listRideHistory,
  requestRide,
} from '../../services/bookings.js';
import { bookingPath } from '../../services/paths.js';
import type { V1Deps } from './index.js';
import { bookingId, trip } from './schemas.js';

const rideRequest = trip.and(
  z.object({ paymentMethod: z.enum(PAYMENT_METHODS, 'must be cash or teslapay') }),
);

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

  // Past rides, newest first, in pages (FR-P6, NFR-36). The ride in progress is at /current.
  router.get('/', async (req, res) => {
    const page = parsePageQuery(req.query);
    const { items, nextCursor } = await listRideHistory(db, currentSession(req).userId, page);
    res.json({ bookings: items, nextCursor });
  });

  router.get('/:id', async (req, res) => {
    const booking = await getBooking(db, currentSession(req).userId, bookingId(req.params.id));
    res.json({ booking });
  });

  // The ride's own road, pickup to destination, to draw (route-paths LLD §3). Never the
  // trip it shares, which passes other passengers' stops (FR-P8).
  router.get('/:id/path', async (req, res) => {
    const id = bookingId(req.params.id);
    res.json(await bookingPath(deps, req.log, currentSession(req).userId, id));
  });

  router.post('/:id/cancel', async (req, res) => {
    const id = bookingId(req.params.id);
    const booking = await cancelRide(deps, req.log, currentSession(req).userId, id);
    res.json({ booking });
  });

  return router;
}
