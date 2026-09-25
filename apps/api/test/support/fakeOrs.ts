import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';

// What the stub does with the next requests.
export type FakeOrsBehaviour =
  | { kind: 'route'; meters: number; delayMs?: number }
  | { kind: 'status'; status: number }
  | { kind: 'body'; body: unknown }
  | { kind: 'hang' };

export interface FakeOrs {
  baseUrl: string;
  hits: number;
  lastAuthorization: string | undefined;
  lastCoordinates: unknown;
  behave: (behaviour: FakeOrsBehaviour) => void;
  close: () => Promise<void>;
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
    lastAuthorization: undefined,
    lastCoordinates: undefined,
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
    fake.lastAuthorization = req.headers.authorization;
    fake.lastCoordinates = (req.body as { coordinates?: unknown }).coordinates;
    const current = behaviour;
    switch (current.kind) {
      case 'route':
        if (current.delayMs) await new Promise((resolve) => setTimeout(resolve, current.delayMs));
        res.json({ routes: [{ summary: { distance: current.meters, duration: 600 } }] });
        return;
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

  return fake;
}
