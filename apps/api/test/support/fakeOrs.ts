import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { encodePolyline } from '../../src/geo/polyline.js';

type LngLat = [number, number];

// What the stub does with the next requests. `route` answers every pair with the same
// distance; `distances` works each pair out, and may say there is no route (null).
export type FakeOrsBehaviour =
  | { kind: 'route'; meters: number; delayMs?: number }
  | { kind: 'distances'; meters: (from: LngLat, to: LngLat) => number | null }
  | { kind: 'status'; status: number }
  | { kind: 'body'; body: unknown }
  | { kind: 'hang' };

export interface FakeOrs {
  baseUrl: string;
  // Requests to either endpoint, and to each one alone.
  hits: number;
  matrixHits: number;
  directionsHits: number;
  lastAuthorization: string | undefined;
  lastCoordinates: unknown;
  lastLocations: LngLat[] | undefined;
  behave: (behaviour: FakeOrsBehaviour) => void;
  close: () => Promise<void>;
}

// A route as ORS sends it: its distance, and its shape as a straight line through the
// points asked for, with each point's place in it.
function directionsRoute(coordinates: LngLat[], meters: number) {
  return {
    summary: { distance: meters, duration: 600 },
    geometry: encodePolyline(coordinates.map(([lng, lat]) => [lat, lng])),
    way_points: coordinates.map((_, i) => i),
  };
}

// A local stand-in for OpenRouteService's directions endpoint. Tests never call the real
// map service (NFR-28).
export async function startFakeOrs(): Promise<FakeOrs> {
  let behaviour: FakeOrsBehaviour = { kind: 'route', meters: 5000 };
  const app = express();
  app.use(express.json());

  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });

  const fake: FakeOrs = {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    hits: 0,
    matrixHits: 0,
    directionsHits: 0,
    lastAuthorization: undefined,
    lastCoordinates: undefined,
    lastLocations: undefined,
    behave: (next) => {
      behaviour = next;
    },
    close: () => {
      // A hanging request would otherwise keep the server open.
      server.closeAllConnections();
      return new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };

  app.post('/v2/directions/driving-car', async (req, res) => {
    fake.hits += 1;
    fake.directionsHits += 1;
    fake.lastAuthorization = req.headers.authorization;
    const coordinates = (req.body as { coordinates: LngLat[] }).coordinates;
    fake.lastCoordinates = coordinates;
    const current = behaviour;
    switch (current.kind) {
      case 'route':
        if (current.delayMs) await new Promise((resolve) => setTimeout(resolve, current.delayMs));
        res.json({ routes: [directionsRoute(coordinates, current.meters)] });
        return;
      case 'distances': {
        const [from, to] = coordinates as [LngLat, LngLat];
        const meters = current.meters(from, to);
        if (meters === null) res.status(404).json({ error: { code: 2010, message: 'no route' } });
        else res.json({ routes: [directionsRoute(coordinates, meters)] });
        return;
      }
      case 'status':
        res.status(current.status).json({ error: { code: 2010, message: 'failed' } });
        return;
      case 'body':
        res.json(current.body);
        return;
      case 'hang':
        // Never answers; the client's timeout has to end it.
        return;
    }
  });

  app.post('/v2/matrix/driving-car', async (req, res) => {
    fake.hits += 1;
    fake.matrixHits += 1;
    fake.lastAuthorization = req.headers.authorization;
    const locations = (req.body as { locations: LngLat[] }).locations;
    fake.lastLocations = locations;
    const current = behaviour;
    switch (current.kind) {
      case 'route':
      case 'distances': {
        if (current.kind === 'route' && current.delayMs) {
          await new Promise((resolve) => setTimeout(resolve, current.delayMs));
        }
        const distances = locations.map((from, i) =>
          locations.map((to, j) => {
            if (i === j) return 0;
            return current.kind === 'route' ? current.meters : current.meters(from, to);
          }),
        );
        res.json({ distances });
        return;
      }
      case 'status':
        res.status(current.status).json({ error: { code: 6099, message: 'failed' } });
        return;
      case 'body':
        res.json(current.body);
        return;
      case 'hang':
        return;
    }
  });

  return fake;
}
