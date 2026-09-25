import { Router } from 'express';
import { currentSession, requireAuth, requireRole } from '../../http/middleware/auth.js';
import { parsePageQuery } from '../../http/pagination.js';
import { getPastTrip, listDriverTrips } from '../../services/history.js';
import {
  acceptRequest,
  completeTrip,
  driverCancel,
  getDriverTrip,
  markArrived,
  markNoShow,
  startTrip,
} from '../../services/pools.js';
import { listNearbyRequests } from '../../services/requests.js';
import { getDriverVehicle, goOffline, goOnline, setLocation } from '../../services/vehicles.js';
import type { V1Deps } from './index.js';
import { bookingId, location, poolId } from './schemas.js';

// The driver's Tesla, availability, rides and history (API Routes §6–9). Drivers only (NFR-8).
export function driverRouter(deps: V1Deps): Router {
  const { db, session, dispatch } = deps;
  const router = Router();
  router.use(requireAuth(session.secret), requireRole('driver'));

  router.get('/vehicle', async (req, res) => {
    res.json({ vehicle: await getDriverVehicle(db, currentSession(req).userId) });
  });

  router.post('/vehicle/online', async (req, res) => {
    res.json({ vehicle: await goOnline(db, currentSession(req).userId) });
  });

  router.post('/vehicle/offline', async (req, res) => {
    res.json({ vehicle: await goOffline(db, currentSession(req).userId) });
  });

  router.put('/vehicle/location', async (req, res) => {
    const body = location.parse(req.body);
    res.json({ vehicle: await setLocation(db, currentSession(req).userId, body) });
  });

  // Polled every 4 seconds while the driver is online (NFR-3).
  router.get('/requests', async (req, res) => {
    const driverId = currentSession(req).userId;
    res.json({ requests: await listNearbyRequests(deps, req.log, driverId, dispatch) });
  });

  // Accepting twice returns the same trip (FR-C5, NFR-37).
  router.post('/requests/:bookingId/accept', async (req, res) => {
    const id = bookingId(req.params.bookingId);
    const driverId = currentSession(req).userId;
    res.json({ pool: await acceptRequest(deps, req.log, driverId, id, dispatch) });
  });

  // The trip in progress, polled every 4 seconds (NFR-3).
  router.get('/pool', async (req, res) => {
    res.json({ pool: await getDriverTrip(db, currentSession(req).userId) });
  });

  // One passenger's ride, a step at a time (FR-D10). Each returns the trip after the step.
  router.post('/bookings/:id/arrive', async (req, res) => {
    const id = bookingId(req.params.id);
    res.json({ pool: await markArrived(db, currentSession(req).userId, id) });
  });

  router.post('/bookings/:id/start', async (req, res) => {
    const id = bookingId(req.params.id);
    res.json({ pool: await startTrip(db, currentSession(req).userId, id) });
  });

  // Also returns the recorded fare for the driver to collect.
  router.post('/bookings/:id/complete', async (req, res) => {
    const id = bookingId(req.params.id);
    res.json(await completeTrip(db, currentSession(req).userId, id));
  });

  // Before pickup only. The request goes back to other drivers, and the route is re-planned
  // without it (FR-D12).
  router.post('/bookings/:id/cancel', async (req, res) => {
    const id = bookingId(req.params.id);
    res.json({ pool: await driverCancel(deps, req.log, currentSession(req).userId, id) });
  });

  // The passenger didn't come: allowed 5 minutes after arriving, and fines them (FR-D11).
  router.post('/bookings/:id/no-show', async (req, res) => {
    const id = bookingId(req.params.id);
    res.json({ pool: await markNoShow(deps, req.log, currentSession(req).userId, id) });
  });

  // Finished trips, newest first, in pages (FR-D15, NFR-36). The trip in progress is /pool.
  router.get('/pools', async (req, res) => {
    const page = parsePageQuery(req.query);
    const { items, nextCursor } = await listDriverTrips(db, currentSession(req).userId, page);
    res.json({ pools: items, nextCursor });
  });

  // One finished trip with its passengers and fares.
  router.get('/pools/:id', async (req, res) => {
    const id = poolId(req.params.id);
    res.json({ pool: await getPastTrip(db, currentSession(req).userId, id) });
  });

  return router;
}
