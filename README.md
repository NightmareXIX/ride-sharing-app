# Dhaka Tesla Pool

Share a seat. Split the fare. Survive Dhaka traffic.

A ride-pooling MVP. Passengers request rides, and a driver accepts them into a shared Tesla.
The Tesla never carries more people than it has seats, and every passenger pays their own fare.

> **Status:** phases 0 to 3 are done. People can sign up as a passenger or a driver, and
> sign in and out. A passenger picks a trip on the map, sees the estimated fare and requests
> the ride. An online driver sees nearby requests and accepts one, then marks arrival,
> starts the trip and completes it. The final fare is recorded with its full breakdown and
> paid in cash. Either side can cancel before pickup. One passenger rides at a time; pooling
> arrives in phase 5. See
> [the development plan](docs/Dhaka%20Tesla%20Pool%20—%20Development%20Plan.md).

## Contents

- [Problem](#problem)
- [Specs, architecture and ERD](#specs-architecture-and-erd)
- [Tech stack and why](#tech-stack-and-why)
- [Project structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Run it with Docker](#run-it-with-docker)
- [Run it without Docker](#run-it-without-docker)
- [Environment variables](#environment-variables)
- [Migrations and seed data](#migrations-and-seed-data)
- [Tests and checks](#tests-and-checks)
- [Demo credentials](#demo-credentials)
- [API overview](#api-overview)
- [Pooling](#pooling)
- [Concurrency](#concurrency)
- [Assumptions](#assumptions)
- [Known limitations](#known-limitations)
- [Still to come](#still-to-come)

## Problem

At 8:41 AM on Banani Road 11, Nusrat books a ride to Mohakhali. Two minutes later Rafiq
books almost the same route to Gulshan 1. Jashim's three-seat Tesla, "Bullet", could take
both. Then Shirin tries for the last seat. The app has to decide who can share a ride and
split the fare fairly. It must never oversell a seat, even when two people tap at the same
instant, and it has to keep enough history to explain afterwards exactly what happened.

## Specs, architecture and ERD

The specs are the source of truth for every phase:

| Document                                                                            | What it holds                                                         |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [Functional requirements](docs/Dhaka_Tesla_Pool_Functional_Requirements.md)         | FR-\* IDs, booking state machine, fare formulas, consistency          |
| [Non-functional requirements](docs/Dhaka_Tesla_Pool_Non_Functional_Requirements.md) | NFR-\* IDs: speed, security, reliability, testing, API rules          |
| [Core entities](docs/Dhaka_Tesla_Pool_Core_Entities.md)                             | Entities and the ERD                                                  |
| [API routes](docs/Dhaka_Tesla_Pool_API_Routes.md)                                   | Every route, grouped by role                                          |
| [Development plan](docs/Dhaka%20Tesla%20Pool%20—%20Development%20Plan.md)           | Phases 0–9 and the workflow for each phase                            |
| [Phase 1 LLD: accounts](docs/lld/phase-1-accounts.md)                               | Tables, sessions, routes and tests for sign-up and sign-in            |
| [Phase 2 LLD: ride requests](docs/lld/phase-2-ride-request.md)                      | Availability, road distance, fare estimate, request and cancel        |
| [Phase 3 LLD: driver flow](docs/lld/phase-3-driver-flow.md)                         | Nearby requests, accept, arrive, start, complete, cancels, final fare |

- Architecture: [docs/Architecture Diagram-selection.png](docs/Architecture%20Diagram-selection.png)
- ERD: [docs/Dhaka Tesla Pool ERD-selection.png](docs/Dhaka%20Tesla%20Pool%20ERD-selection.png)

The ERD shows the target schema. The database grows one migration per phase, so today it
holds `users`, `wallets`, `vehicles` (with online status and location), `pools`,
`bookings` (with their lifecycle times), `booking_status_history`, `fares` and
`distance_cache`.

The browser talks only to the Next.js site. The site proxies `/api/v1/*` to the Express
API, so the login cookie is first-party even though the two run on different hosts.

## Tech stack and why

The brief fixes the language family, React/Next.js and Node.js. The rest is our choice.

| Part           | Pick                                         | Alternatives considered    | Why it fits a ride-pooling MVP                                                                                                                                                                                                                                | What would make us switch                                                                                      |
| -------------- | -------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Language       | TypeScript (web and API)                     | JavaScript                 | One type system from the database to the screen, which catches shape mismatches early (NFR-25).                                                                                                                                                               | Nothing realistic for this project.                                                                            |
| Frontend       | Next.js (App Router)                         | React + Vite + a router    | Routing and layouts built in. Its rewrites give a same-origin proxy to the API, so the auth cookie works without CORS.                                                                                                                                        | A fully static client with no proxy need.                                                                      |
| Backend        | Express 5                                    | Fastify, NestJS            | Small and well understood. Express 5 forwards async errors to the error handler, which is all we need. We didn't want NestJS's structure for about 25 routes.                                                                                                 | Throughput limits (Fastify), or a team that wants enforced module structure (NestJS).                          |
| Database       | PostgreSQL 17                                | MySQL, SQLite              | Seat capacity and single-claim rules need row locks, conditional `UPDATE … WHERE`, CHECK constraints, partial unique indexes and triggers. Postgres has all of them. SQLite locks the whole database on writes, so it can't show a real concurrent seat race. | Nothing at MVP scale. At very large scale we'd shard or add read replicas; see the HLD.                        |
| ORM            | Drizzle (+ drizzle-kit)                      | Prisma, Kysely             | Queries read like the SQL they run, so the concurrency rules (FR-C1–C7) stay visible and easy to defend. drizzle-kit writes plain SQL migration files we can review and hand-edit. `numeric` comes back as a string, which suits exact money maths.           | If we needed hand-written SQL everywhere we'd use Kysely. If the team preferred a heavier abstraction, Prisma. |
| Validation     | Zod                                          | Joi                        | TypeScript types are inferred from the schemas, so a validated request body is also typed. It validates env config at startup too (NFR-10, NFR-11).                                                                                                           | Nothing expected.                                                                                              |
| Tests          | Vitest                                       | Jest                       | Runs TypeScript and ESM natively with no transform setup. Tests call the real HTTP stack with `fetch` against a real Postgres, with no extra test libraries.                                                                                                  | Nothing expected.                                                                                              |
| Money maths    | big.js                                       | decimal.js, integer poysha | Exact decimal arithmetic with half-up rounding in a few KB. Fares multiply by 1.05 and 1.15, and plain JavaScript numbers get some of them wrong: (30 + 20 × 0.115) × 1.15 comes out as 37.144999…, not 37.145.                                               | A need for functions big.js lacks (decimal.js).                                                                |
| Styling        | Tailwind CSS                                 | CSS Modules                | Responsive layouts for phones and laptops (NFR-21) without a growing set of CSS files.                                                                                                                                                                        | A designer-owned design system with its own CSS.                                                               |
| Map            | react-leaflet + OpenStreetMap tiles          | MapLibre                   | Leaflet is small, needs no API key and shows the OSM credit by default (NFR-24).                                                                                                                                                                              | Vector maps or heavy map interaction (MapLibre).                                                               |
| Road distances | OpenRouteService, fallback haversine × 1.3   | OSRM, Dhaka zone table     | A free key with enough quota for a demo. The fallback keeps the app working on an evaluator's machine with no key (NFR-13).                                                                                                                                   | Quota limits: self-host OSRM.                                                                                  |
| Logging        | pino + pino-http                             | winston, morgan            | Structured JSON with a request id on every line, and header-free entries so cookies never reach the logs (NFR-42/43).                                                                                                                                         | A hosted log pipeline with its own agent.                                                                      |
| Passwords      | bcryptjs                                     | bcrypt (native), argon2    | The bcrypt algorithm (NFR-7) in pure JS, so the Alpine images need no native build step.                                                                                                                                                                      | Login throughput: switch to native bcrypt or argon2.                                                           |
| Hosting        | Vercel, Render (Singapore), Neon (Singapore) | Railway, Fly.io            | All free tiers. The API and database share a region, which keeps query latency low.                                                                                                                                                                           | Free-tier sleep becomes unacceptable.                                                                          |
| CI             | GitHub Actions                               | —                          | Runs format, lint, typecheck, build and tests against a Postgres service on every PR (NFR-30).                                                                                                                                                                | —                                                                                                              |

Version pins worth knowing: TypeScript is held at 6.0 because typescript-eslint doesn't
support TypeScript 7 yet. ESLint is held at 9 because Next's lint plugins don't support
ESLint 10 yet.

**Money** is stored as `DECIMAL(10,2)` and handled with decimal arithmetic, never floats. It
travels over the API as strings like `"116.00"`. We chose decimal taka over integer poysha
because the fare formula multiplies by factors like 1.05 and 1.15. Keeping full precision
until one final half-up rounding (FR-F5) makes every fare checkable by hand. The API does
that maths with big.js; the website only formats the strings it receives, and compares
amounts in whole poysha.

## Project structure

```
apps/
  api/                 Express API
    src/
      app.ts           builds the app (no listen), used by server.ts and tests
      server.ts        starts listening and shuts down cleanly on SIGTERM
      config.ts        env validation
      http/            error envelope and middleware (request log, auth, role checks)
      auth/            password hashing and the signed session cookie
      domain/          pure rules with no I/O: fares, booking state machine, dispatch
      geo/             Dhaka service area, OpenRouteService client, ×1.3 fallback
      services/        business rules and transactions, called by the routes
      routes/          /health and /api/v1
      db/              schema, client, migrator, seeder and their CLIs
    drizzle/           versioned SQL migrations (generated, then reviewed)
    test/              Vitest tests against a real Postgres
  web/                 Next.js site (App Router + Tailwind)
docs/                  specs and diagrams
docker-compose.yml     web + api + db
.github/workflows/     CI
```

npm workspaces tie the two apps together. One `package-lock.json` at the root pins everything.

## Prerequisites

- Docker with Compose v2 (to run everything)
- Node.js 24 and npm 11 (only to develop or run the tests on your machine)

## Run it with Docker

```sh
docker compose up --build
```

| Service | URL                   | Notes                                      |
| ------- | --------------------- | ------------------------------------------ |
| web     | http://localhost:3000 | proxies `/api/v1/*` to the API             |
| api     | http://localhost:4000 | `/health`, `/health/ready`, `/api/v1/*`    |
| db      | localhost:5432        | Postgres 17, user/password `tesla`/`tesla` |

Startup order is enforced by health checks. The API waits until Postgres is ready, then
applies migrations and loads the seed, then starts listening. The website waits until the
API reports ready. No `.env` file is needed. To change ports or credentials, copy
`.env.example` to `.env`.

Road distances come from OpenRouteService when `ORS_API_KEY` is set (a free key is enough).
Without it, every distance uses the straight-line fallback and the fare estimate says so.
Everything still works.

Reset everything, including the database volume, with `docker compose down -v`.

## Run it without Docker

```sh
cp .env.example .env
npm ci
docker compose up -d db              # or point DATABASE_URL at any Postgres 17
npm run db:migrate -w @tesla-pool/api
npm run db:seed -w @tesla-pool/api
npm run dev -w @tesla-pool/api       # http://localhost:4000, restarts on change
npm run dev -w @tesla-pool/web       # http://localhost:3000, in a second terminal
```

## Environment variables

All of them are listed in [.env.example](.env.example) with safe local defaults. Real
secrets live only in the hosting platforms' settings (NFR-11).

| Variable                                            | Used by     | Purpose                                                                          |
| --------------------------------------------------- | ----------- | -------------------------------------------------------------------------------- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | compose     | Database credentials; compose also builds the API's URL from them                |
| `POSTGRES_PORT`, `API_PORT`, `WEB_PORT`             | compose     | Host ports                                                                       |
| `DATABASE_URL`                                      | api         | Postgres connection string (`postgres://…`)                                      |
| `PORT`                                              | api         | HTTP port, default 4000                                                          |
| `NODE_ENV`                                          | api         | `development` turns on pretty logs                                               |
| `LOG_LEVEL`                                         | api         | pino level, default `info`                                                       |
| `SESSION_SECRET`                                    | api         | Signs the login cookie; at least 32 characters. Required.                        |
| `COOKIE_SECURE`                                     | api         | `Secure` cookie flag; defaults to on when `NODE_ENV=production`                  |
| `ORS_API_KEY`                                       | api         | OpenRouteService key. Optional: unset means straight-line distance × 1.3         |
| `ORS_BASE_URL`                                      | api         | OpenRouteService address, default `https://api.openrouteservice.org`             |
| `DRIVER_SEARCH_RADIUS_KM`                           | api         | How far (straight line) from their Tesla an idle driver sees requests, default 2 |
| `TEST_DATABASE_URL`                                 | api tests   | Separate test database, created automatically if missing                         |
| `API_URL`                                           | web (build) | Where the proxy sends `/api/v1/*`. It's read at **build** time.                  |

## Migrations and seed data

- Change the schema in `apps/api/src/db/schema/`, then run
  `npm run db:generate -w @tesla-pool/api`. That writes a new SQL file under
  `apps/api/drizzle/`. Review it and commit it (NFR-31).
- `npm run db:migrate -w @tesla-pool/api` applies any migrations that haven't run yet. The
  Docker container does this on every start.
- `npm run db:seed -w @tesla-pool/api` loads the story cast. It is idempotent: existing
  users are left untouched, so restarting never resets your demo progress.

## Tests and checks

```sh
docker compose up -d db     # tests need a real Postgres
npm test                    # Vitest, against the tesla_pool_test database
npm run lint
npm run typecheck
npm run format:check
npm run build
```

CI runs the same steps on every pull request. Tests never call the real map service: a
local stub stands in for OpenRouteService. Concurrency tests run against a real database
and repeat several rounds (NFR-28).

Covered so far:

- Liveness and readiness, including a 503 when the database is unreachable
- The error envelope for unknown routes and malformed JSON
- Request-id generation and safe propagation
- Seed idempotency and password hashing, plus every cast wallet and Jashim's Bullet
- Sign-up rules: required gender, a Tesla for drivers only, seat limits, one transaction
- Ten simultaneous sign-ups with one email, five rounds: exactly one account each time
- Sign-in: a wrong password and an unknown email get the same answer
- Sessions: missing, tampered, foreign-secret and expired tokens get 401; the wrong role gets 403
- Driver availability: no going online without a location, locations outside Dhaka refused,
  repeated online and offline harmless
- Road distance: routed answers cached by direction; the fallback used only for no key, an
  error, a quota refusal, a bad body or the 10 s timeout; a slow answer still used
- Fare estimate: the FR §8 worked examples, half-up rounding, and a case floats get wrong
- Booking state machine: every FR §6 transition allowed, and the listed bad ones refused
- Ride requests: validation, balance rules, a repeated request returning the same booking,
  and ten identical requests at once (five rounds) creating exactly one
- Access: another passenger's booking is 404; drivers get 403 on passenger routes
- Cancel: free while waiting, safe to repeat, and logged in a history the database won't
  let anyone edit or delete
- Nearby requests: hidden from offline drivers and full Teslas, and outside the search
  radius or the free seats; oldest first; never naming the passenger
- Accept: opens a trip with its history row, or joins the one running when it fits the
  route and the free seats; a repeat returns the same trip; a second driver gets
  `ALREADY_CLAIMED`; offline and out-of-range accepts refused
- Trip steps: arrive, start and complete in order, each repeat harmless, skipped steps
  refused, another driver's passenger 404
- Final fare: the FR §8 pooled examples (116.00, 174.00, 182.70), capped at the estimate,
  stored with its breakdown in a table the database won't let anyone change
- Driver cancel: the request returns to waiting for every driver, keeping its pool in the
  history; not allowed once the passenger is aboard
- Passenger cancel after acceptance: free within 3 minutes and recorded as `late_cancel`
  after, by the database clock; refused once the trip starts
- A driver with a passenger can't go offline or move their Tesla
- Seat limit: Bullet fills seat by seat and then refuses; every way out of a trip frees
  its seats once; raw SQL can't overfill a Tesla; an accept against an out-of-date Tesla
  gets `POOL_CHANGED`; co-passengers never see each other
- Matching rule (FR-L3): each reason a request is turned away, the pickup the driver waits
  at staying first, the shortest route winning, and ties settled the same way every time
- Nusrat and Rafiq's pooled trip end to end: Rafiq listed as adding 0.970 km, the four
  stops in order, and fares of ৳ 52.02 and ৳ 71.42 that match the hand calculation below;
  the old Mohakhali pin turning Rafiq away
- Route stops: steps out of order refused with `OUT_OF_STOP_ORDER`; readings recorded at
  pickup and drop-off, which the database won't let anyone change; either cancel removing
  the passenger's stops and shortening the route; an accept planned against an older route
  refused
- Road distances for a route: one matrix request for every pair, cached; the fallback per
  pair; at most 3 map requests per list refresh, the rest checked on the next one
- Races, 25 rounds each against Postgres: Nusrat and Shirin for the last seat (exactly one
  wins); five accepts into one Tesla (never more than 3); accepts racing steps and cancels
  (seats and route stay right, no deadlock); three drivers for one request (one wins); a
  double-tapped accept (one trip); five requests from one passenger (one booking). After
  each round, every trip's stops are checked against its bookings.

## Demo credentials

Every seeded account uses the password **`TeslaPool#2026`**.

| Name   | Email                 | Role      | Gender |
| ------ | --------------------- | --------- | ------ |
| Jashim | jashim@teslapool.test | driver    | male   |
| Nusrat | nusrat@teslapool.test | passenger | female |
| Rafiq  | rafiq@teslapool.test  | passenger | male   |
| Shirin | shirin@teslapool.test | passenger | female |

Sign in at http://localhost:3000/login. Jashim drives the Tesla "Bullet" (3 seats), which
starts offline at Banani Road 11. Every wallet starts at ৳ 0.00; top-ups arrive with
TeslaPay in phase 6, so ride requests use Cash until then.

To try a ride: sign in as Jashim and go online. In another browser, sign in as Nusrat,
choose Banani Road 11 → Mohakhali, get the estimate and request the ride. Within a few
seconds it appears in Jashim's nearby requests. Accept it, then tap **Arrived at pickup**,
**start trip** and **complete trip**. Nusrat's screen follows each step and ends with the
fare to pay in cash and how it was worked out. To see a driver cancel, tap **Cancel ride**
before starting: the request goes back to waiting and Nusrat is told why.

To see a pooled ride: with Jashim online at Banani Road 11, have Nusrat request Banani Road
11 → Mohakhali and accept it. Then have Rafiq request Banani Road 11 → Gulshan 1. Jashim
sees it under **Requests on your route**, adding 0.970 km. Accept it: the route lists
Nusrat's pickup, Rafiq's pickup, Nusrat's drop-off, then Rafiq's, and only the next stop
has a button. Take the steps in order. With no map key, Nusrat pays ৳ 52.02 and Rafiq
৳ 71.42 ([worked out below](#pooling)), and each sees only their own fare.

To see the last-seat race: with Jashim online at Banani Road 11, have Rafiq request 2 seats
to Gulshan 1 and accept it. Bullet shows 2 of 3 seats taken. Then have Nusrat and Shirin
each request 1 seat from Banani Road 11 to Mohakhali, which is on Rafiq's way. Open
Jashim's screen in two tabs and tap **Accept** on a different request in each at the same
moment. One gets the seat; the other is told there is no free seat any more, and Bullet
shows 3 of 3.

## API overview

REST over JSON. Everything is under `/api/v1` except the health checks (NFR-34). The full
list of routes is in [the API routes spec](docs/Dhaka_Tesla_Pool_API_Routes.md).

| Method | Route           | Returns                                                                         |
| ------ | --------------- | ------------------------------------------------------------------------------- |
| GET    | `/health`       | `200 { "status": "ok" }` while the process is up                                |
| GET    | `/health/ready` | `200 { "status": "ok", "database": "up" }`, or `503` if Postgres is unreachable |

Accounts (phase 1), all under `/api/v1`:

| Method | Route          | Does                                                                       | Errors                         |
| ------ | -------------- | -------------------------------------------------------------------------- | ------------------------------ |
| POST   | `/auth/signup` | Creates the account, its wallet and a driver's Tesla; signs in. **201**    | 400, 409 `EMAIL_TAKEN`         |
| POST   | `/auth/login`  | Signs in with email and password. **200**                                  | 400, 401 `INVALID_CREDENTIALS` |
| POST   | `/auth/logout` | Clears the session cookie. **204**, with or without a session              | —                              |
| GET    | `/me`          | The user, `wallet.balance` as a string (`"0.00"`), and the Tesla or `null` | 401 `UNAUTHENTICATED`          |

Signing in sets `tp_session`, an HttpOnly, SameSite=Lax cookie that lasts 24 hours
(NFR-6). It holds a signed token (HS256 JWT), so there is no sessions table. Request and
response shapes are in the [phase 1 LLD](docs/lld/phase-1-accounts.md#4-routes).

Ride requests (phase 2), all under `/api/v1`:

| Method | Route                      | Who       | Does                                                                     | Errors                                                                               |
| ------ | -------------------------- | --------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| GET    | `/driver/vehicle`          | driver    | The Tesla: seats, `isOnline`, `location`                                 | 404                                                                                  |
| POST   | `/driver/vehicle/online`   | driver    | Goes online; repeating it is harmless                                    | 422 `LOCATION_REQUIRED`                                                              |
| POST   | `/driver/vehicle/offline`  | driver    | Goes offline; repeating it is harmless                                   | —                                                                                    |
| PUT    | `/driver/vehicle/location` | driver    | Sets `{ lat, lng }` inside Dhaka                                         | 400                                                                                  |
| POST   | `/fare-estimates`          | passenger | Road distance and estimate, every step as a string. Books nothing.       | 400                                                                                  |
| POST   | `/bookings`                | passenger | Requests a ride. **201**; the same request again returns it with **200** | 400, 409 `ACTIVE_BOOKING_EXISTS`, 422 `NEGATIVE_BALANCE`, 422 `INSUFFICIENT_BALANCE` |
| GET    | `/bookings/current`        | passenger | The active booking or `null`; the app polls it every 4 s                 | —                                                                                    |
| GET    | `/bookings/:id`            | passenger | One of the passenger's own bookings                                      | 404                                                                                  |
| POST   | `/bookings/:id/cancel`     | passenger | Cancels a waiting request for free; repeating it is harmless             | 404, 409 `INVALID_TRANSITION`                                                        |

A route for the other role returns 403, and no session returns 401. `/me` also returns the
passenger's `currentBooking`. Shapes and rules are in the
[phase 2 LLD](docs/lld/phase-2-ride-request.md#3-routes).

Driver flow (phase 3), all under `/api/v1`:

| Method | Route                           | Who    | Does                                                                               | Errors                                                                                                                       |
| ------ | ------------------------------- | ------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/driver/requests`              | driver | Open requests near an online, idle Tesla, oldest first; polled every 4 s           | —                                                                                                                            |
| POST   | `/driver/requests/:id/accept`   | driver | Accepts the request into a new trip; a repeat returns the same trip                | 404, 409 `ALREADY_CLAIMED`, 409 `SEATS_UNAVAILABLE`, 409 `INVALID_TRANSITION`, 422 `DRIVER_OFFLINE`, 422 `NO_LONGER_MATCHES` |
| GET    | `/driver/pool`                  | driver | The trip in progress: each passenger, their seats, status and next step, or `null` | —                                                                                                                            |
| POST   | `/driver/bookings/:id/arrive`   | driver | ACCEPTED → DRIVER_ARRIVED                                                          | 404, 409 `INVALID_TRANSITION`                                                                                                |
| POST   | `/driver/bookings/:id/start`    | driver | DRIVER_ARRIVED → STARTED                                                           | 404, 409 `INVALID_TRANSITION`                                                                                                |
| POST   | `/driver/bookings/:id/complete` | driver | STARTED → COMPLETED; records and returns the fare                                  | 404, 409 `INVALID_TRANSITION`                                                                                                |
| POST   | `/driver/bookings/:id/cancel`   | driver | Before pickup: the request goes back to waiting for any driver                     | 404, 409 `INVALID_TRANSITION`                                                                                                |

Phase 3 also changes three phase 2 routes. Going offline or moving the Tesla returns 409
`HAS_ACTIVE_BOOKINGS` while it has a passenger. A passenger can cancel until the trip
starts. The booking body gains the driver and Tesla, each step's time, `freeCancelUntil`, a
`notice` after a driver cancel, and the `fare` breakdown once completed. Shapes and rules
are in the [phase 3 LLD](docs/lld/phase-3-driver-flow.md#3-routes).

Seats and concurrency (phase 4) adds no routes. A Tesla with free seats keeps seeing
requests that fit them, and an accept joins the trip already running. `GET /driver/vehicle`
gains `occupiedSeats`, and the trip body gains `seats: { capacity, taken }`. An accept can
now also fail with 409 `POOL_CHANGED` when the Tesla changed while it was being accepted.
Shapes and rules are in the [phase 4 LLD](docs/lld/phase-4-seat-capacity.md#3-routes).

Pooling (phase 5) adds no routes either. A Tesla with passengers lists only requests that
fit its route, each with `addedKm`, and an accept that doesn't fit gets 422
`NO_LONGER_MATCHES`. The trip body gains `stops` (in order, each with its planned km, its
reading once reached, and `isNext`) and `odometerKm`, and each passenger gains `canAct`.
Arrive and complete return 409 `OUT_OF_STOP_ORDER` unless that passenger's stop is next.
The fare breakdown gains `routeDistanceMethod`. Shapes and rules are in the
[phase 5 LLD](docs/lld/phase-5-tesla-pooling.md#3-routes).

Every error has the same shape (NFR-35):

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [] } }
```

Every response carries an `X-Request-Id` header, and the same id appears on that
request's log line (NFR-42).

## Pooling

**The route.** Each trip has an ordered list of stops: a pickup and a drop-off for every
passenger. Each stop has its km along the trip, counted from where Bullet stood when the
trip began. When the driver starts or completes a passenger's ride, that stop's planned km
becomes its reading, and the database refuses any later change to it (FR-L5, NFR-41). The
driver takes the stops in order.

**The matching rule (FR-L3).** A request joins a trip with passengers only if its stops can
go into the remaining route so that:

1. the pickup lies on the route ahead: visiting it adds at most 1 km to the leg it joins;
2. the drop-off lies on the route after the pickup in the same way, or past the route's
   end, which may extend towards it but not branch off;
3. nobody's ride, including the newcomer's, grows more than 1 km beyond their direct
   distance;
4. nobody would pay more than their estimate: `detour ≤ 0.4 × shared km`, which is the fare
   formula rearranged;
5. there are enough free seats.

Every place for the two new stops is tried, and the one that makes the route shortest wins.
The rule lives in [`domain/matching.ts`](apps/api/src/domain/matching.ts), which does no
I/O, so it is tested on its own (NFR-26). A route check needs many road distances, so it
makes one OpenRouteService matrix request for all of them and caches the answers. Each
refresh of the driver's list makes at most 3 such requests (NFR-3).

**Nusrat and Rafiq's trip (FR-L4).** Both start at Banani Road 11, where Bullet waits. With
no map key the distances are straight-line × 1.3: Banani → Mohakhali 1.835 km, Banani →
Gulshan 1 2.287 km, Mohakhali → Gulshan 1 0.970 km.

- Jashim accepts Nusrat first. The route is her pickup at 0.000 km, then her drop-off at
  1.835 km.
- Rafiq fits if Nusrat is dropped first: his ride is 1.835 + 0.970 = 2.805 km against a
  direct 2.287, a 0.518 km detour. That is under 1 km and under 0.4 × 1.835 = 0.734, the
  km he shares with Nusrat. Dropping Rafiq first would stretch Nusrat's ride by 1.422 km,
  so it isn't allowed.
- The route becomes: pick up Nusrat 0.000, pick up Rafiq 0.000, drop off Nusrat 1.835, drop
  off Rafiq 2.805.

| Fare = (30 + 20 × actual km − 8 × shared km), capped at the estimate | Nusrat             | Rafiq              |
| -------------------------------------------------------------------- | ------------------ | ------------------ |
| Odometer at pickup → drop-off                                        | 0.000 → 1.835      | 0.000 → 2.805      |
| Actual km, shared km                                                 | 1.835, 1.835       | 2.805, 1.835       |
| Estimate: 30 + 20 × direct km                                        | 30 + 36.70 = 66.70 | 30 + 45.74 = 75.74 |
| Computed                                                             | 30 + 36.70 − 14.68 | 30 + 56.10 − 14.68 |
| **Final**                                                            | **৳ 52.02**        | **৳ 71.42**        |

Both ride 1 seat on a Pool ride, so both multipliers are 1. With an OpenRouteService key
the distances come from real roads, so the numbers differ.

**Why the Mohakhali pin moved.** At the first Mohakhali pin (23.7781, 90.4050), Gulshan 1
branches off the way to Mohakhali, and whichever passenger is dropped second rides about
1.5 km further than their direct trip. FR-L3 allows 1 km, so they wouldn't pool. FR §13
left this to be checked once routing was built. Rather than loosen the rule, the Mohakhali
quick pick moved to Wireless Gate (23.7812, 90.4090), where the road from Mohakhali to
Gulshan 1 begins.

## Concurrency

The PRD's problem: Bullet has one seat left, and Nusrat and Shirin both try to claim it at
nearly the same instant, both having seen one seat free. Here a driver accepts requests
rather than passengers picking a Tesla (FR-D8), so the race is two accepts into Bullet at
once: two taps, two tabs, or a retry landing beside the original.

**How it's handled now.** Every rule is enforced by Postgres, not by the API's memory, so
it holds with any number of API copies (NFR-19, NFR-20).

| Rule                                    | How                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seats never exceed capacity (FR-C1)     | An accept claims its seats with one statement: `UPDATE vehicles SET occupied_seats = occupied_seats + $seats, version = version + 1 WHERE id = $tesla AND is_online AND version = $seen AND occupied_seats + $seats <= capacity`. A second accept waits for the row lock, then Postgres checks its `WHERE` again against the new row. `CHECK (occupied_seats BETWEEN 0 AND capacity)` backs it up. |
| Exactly one wins the last seat (FR-R3)  | The same statement. The loser gets 0 rows, then 409 `SEATS_UNAVAILABLE`, and its transaction changes nothing.                                                                                                                                                                                                                                                                                      |
| Out-of-date accepts are refused (FR-C3) | Every write to a Tesla, and every step that moves its route on, bumps its `version`. An accept is checked and its route planned without locks, and committed only if the version hasn't moved; otherwise 409 `POOL_CHANGED`, try again. Completing and cancelling plan the same way and retry up to 3 times, so no transaction waits on the map service.                                           |
| One driver per request (FR-C2)          | `UPDATE bookings … WHERE status = 'REQUESTED'`. The losing driver gets `ALREADY_CLAIMED`, and the rollback returns its seats.                                                                                                                                                                                                                                                                      |
| Double taps (FR-C5, NFR-37)             | A repeated accept returns the same trip; a repeated request returns the same booking.                                                                                                                                                                                                                                                                                                              |
| One active booking (FR-C6)              | A partial unique index on `bookings(passenger_id)` for unfinished states.                                                                                                                                                                                                                                                                                                                          |
| No deadlocks (FR-C7)                    | Every transaction locks the Tesla, then the booking, then the trip. A passenger cancel finds its Tesla first and locks it before the booking, retrying if the booking changed Tesla in between.                                                                                                                                                                                                    |

[`apps/api/test/concurrency.test.ts`](apps/api/test/concurrency.test.ts) fires each race
with `Promise.all` against a real Postgres, 25 rounds each. After every round it checks
that each Tesla's seats taken equal the seats of the bookings it carries.

**The trade-off.** The version check is optimistic. When several accepts hit one Tesla at
the same moment, some are told `POOL_CHANGED` even though a seat was free. One driver
rarely taps that fast, and a retry succeeds.

**What we'd change at larger scale.**

- Keep the seat claim as a single-row conditional update, and shard by area so a Tesla,
  its trip and its bookings live on one shard and the claim never spans two.
- Serve the nearby-request list from a read replica or a geo index (Redis GEO) instead of
  the primary; only the claim needs the primary.
- Push changes over WebSockets instead of polling every 4 s, so drivers act on fresher
  lists and fewer accepts are out of date.
- Send idempotency keys with accepts and requests, so retries across dropped connections
  are recognised even after the first attempt finished.
- If one shard can't keep up, queue accepts per Tesla (a partitioned log keyed by vehicle)
  so they apply in order, with the database check still as the backstop.

## Assumptions

- **Seed genders.** The brief doesn't give genders. We assume Nusrat and Shirin are female
  and Jashim and Rafiq are male, so a same-gender pool can be demonstrated.
- **Demo password.** One shared, published password for all seeded accounts. They are
  demo accounts, not secrets.
- **Seat limit.** A Tesla has 1 to 6 passenger seats. The largest model, the Model X,
  seats 6 besides the driver.
- **Wallets start empty.** Balances stay at ৳ 0.00 until the TeslaPay ledger exists
  (phase 6), so every taka in a wallet is backed by a ledger entry (NFR-39). Until then a
  TeslaPay request is refused with `INSUFFICIENT_BALANCE`.
- **Dhaka only.** Pickups, destinations and driver locations must fall inside a box from
  Uttara to Old Dhaka (latitude 23.65–23.95, longitude 90.30–90.55).
- **Short trips.** Pickup and destination must be at least 100 m apart in a straight line.
- **Seats.** A request can't ask for more seats than the largest registered Tesla has.
- **Bullet's start.** The seed parks Bullet at Banani Road 11, where the story begins.
- **Two rules arrive early.** One active booking per passenger (FR-C6) and the balance
  checks (FR-W3, FR-W7) were planned for phases 4 and 6. They are enforced from phase 2
  because creating a request depends on them.
- **The Mohakhali pin.** The Mohakhali quick pick is Wireless Gate, so Nusrat's and
  Rafiq's story trips pool under the matching rule ([why](#pooling)).
- **Where a trip's km start.** A trip's odometer reads 0 where the Tesla stood when the trip
  began. Two stops at the same place are 0 km apart, with no map request.
- **Nearby means a straight line.** The 2 km search radius is measured as the crow flies
  from the Tesla, so refreshing the list never waits on the map service.
- **A cancelled pickup's km.** If a passenger cancels while the driver waits at their
  pickup, the route is planned again from the last stop reached. The km driven to that
  pickup aren't charged to anyone still aboard.
- **Stop searching.** After a driver cancel, the passenger's request waits again and their
  screen says why. Cancelling a waiting request is free, which serves as the "stop
  searching" option FR §13 left to the design.

## Known limitations

See [NFR §11](docs/Dhaka_Tesla_Pool_Non_Functional_Requirements.md#11-known-limitations) for
the full list. Specific to the current state:

- Next.js resolves the API proxy address at build time. The web image has to be rebuilt to
  point at a different API.
- Signing out clears the cookie, but sessions are stateless. A token copied before
  sign-out keeps working until its 24 hours are up.
- Without `ORS_API_KEY`, every distance is straight-line × 1.3, so estimates are
  approximate. The screen says so.
- Choosing places on the map needs a mouse or touch. The quick-pick buttons work from the
  keyboard.
- Map tiles come from the public OpenStreetMap servers, which suit a demo but not heavy use.
- drizzle-kit, a dev-only tool, pulls in an old esbuild that `npm audit` flags. It never
  reaches the Docker images.
- A late passenger cancel is recorded as `late_cancel` but not fined yet, and a late
  driver cancel leaves no penalty record. Both need the wallet ledger (phase 6).
- Completing a ride records the fare, but no money moves: cash is paid in person and the
  ledger entries arrive in phase 6.
- While the map service is failing, fallback distances aren't cached. The same 3 requests
  then ask it again on every refresh, and a fourth waits until it recovers.
- A Tesla stays where its trip began until the driver moves it. It isn't moved to the last
  drop-off when the trip ends.
- The dashed line on the driver's map joins the stops in order; it isn't the road.

## Still to come

- Features implemented, screenshots, API details per phase (phases 1–8)
- Deployment URL (phase 9)
- Viral-scale design (HLD)
- AI Usage
- Demo video
