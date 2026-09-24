# Dhaka Tesla Pool

Share a seat. Split the fare. Survive Dhaka traffic.

A ride-pooling MVP. Passengers request rides, and a driver accepts them into a shared Tesla.
The Tesla never carries more people than it has seats, and every passenger pays their own fare.

> **Status:** phases 0 (foundations) and 1 (accounts) are done. People can sign up as a
> passenger or as a driver with their Tesla, sign in and out, and see their TeslaPay
> balance. Ride features arrive phase by phase; see [the development plan](docs/Dhaka%20Tesla%20Pool%20—%20Development%20Plan.md).

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

| Document                                                                            | What it holds                                                |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [Functional requirements](docs/Dhaka_Tesla_Pool_Functional_Requirements.md)         | FR-\* IDs, booking state machine, fare formulas, consistency |
| [Non-functional requirements](docs/Dhaka_Tesla_Pool_Non_Functional_Requirements.md) | NFR-\* IDs: speed, security, reliability, testing, API rules |
| [Core entities](docs/Dhaka_Tesla_Pool_Core_Entities.md)                             | Entities and the ERD                                         |
| [API routes](docs/Dhaka_Tesla_Pool_API_Routes.md)                                   | Every route, grouped by role                                 |
| [Development plan](docs/Dhaka%20Tesla%20Pool%20—%20Development%20Plan.md)           | Phases 0–9 and the workflow for each phase                   |
| [Phase 1 LLD: accounts](docs/lld/phase-1-accounts.md)                               | Tables, sessions, routes and tests for sign-up and sign-in   |

- Architecture: [docs/Architecture Diagram-selection.png](docs/Architecture%20Diagram-selection.png)
- ERD: [docs/Dhaka Tesla Pool ERD-selection.png](docs/Dhaka%20Tesla%20Pool%20ERD-selection.png)

The ERD shows the target schema. The database grows one migration per phase, so today it
holds `users`, `wallets` and `vehicles`.

The browser talks only to the Next.js site. The site proxies `/api/v1/*` to the Express
API, so the login cookie is first-party even though the two run on different hosts.

## Tech stack and why

The brief fixes the language family, React/Next.js and Node.js. The rest is our choice.

| Part           | Pick                                         | Alternatives considered | Why it fits a ride-pooling MVP                                                                                                                                                                                                                                | What would make us switch                                                                                      |
| -------------- | -------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Language       | TypeScript (web and API)                     | JavaScript              | One type system from the database to the screen, which catches shape mismatches early (NFR-25).                                                                                                                                                               | Nothing realistic for this project.                                                                            |
| Frontend       | Next.js (App Router)                         | React + Vite + a router | Routing and layouts built in. Its rewrites give a same-origin proxy to the API, so the auth cookie works without CORS.                                                                                                                                        | A fully static client with no proxy need.                                                                      |
| Backend        | Express 5                                    | Fastify, NestJS         | Small and well understood. Express 5 forwards async errors to the error handler, which is all we need. We didn't want NestJS's structure for about 25 routes.                                                                                                 | Throughput limits (Fastify), or a team that wants enforced module structure (NestJS).                          |
| Database       | PostgreSQL 17                                | MySQL, SQLite           | Seat capacity and single-claim rules need row locks, conditional `UPDATE … WHERE`, CHECK constraints, partial unique indexes and triggers. Postgres has all of them. SQLite locks the whole database on writes, so it can't show a real concurrent seat race. | Nothing at MVP scale. At very large scale we'd shard or add read replicas; see the HLD.                        |
| ORM            | Drizzle (+ drizzle-kit)                      | Prisma, Kysely          | Queries read like the SQL they run, so the concurrency rules (FR-C1–C7) stay visible and easy to defend. drizzle-kit writes plain SQL migration files we can review and hand-edit. `numeric` comes back as a string, which suits exact money maths.           | If we needed hand-written SQL everywhere we'd use Kysely. If the team preferred a heavier abstraction, Prisma. |
| Validation     | Zod                                          | Joi                     | TypeScript types are inferred from the schemas, so a validated request body is also typed. It validates env config at startup too (NFR-10, NFR-11).                                                                                                           | Nothing expected.                                                                                              |
| Tests          | Vitest                                       | Jest                    | Runs TypeScript and ESM natively with no transform setup. Tests call the real HTTP stack with `fetch` against a real Postgres, with no extra test libraries.                                                                                                  | Nothing expected.                                                                                              |
| Styling        | Tailwind CSS                                 | CSS Modules             | Responsive layouts for phones and laptops (NFR-21) without a growing set of CSS files.                                                                                                                                                                        | A designer-owned design system with its own CSS.                                                               |
| Map (phase 2)  | react-leaflet + OpenStreetMap tiles          | MapLibre                | Leaflet is small, needs no API key and shows the OSM credit by default (NFR-24).                                                                                                                                                                              | Vector maps or heavy map interaction (MapLibre).                                                               |
| Road distances | OpenRouteService, fallback haversine × 1.3   | OSRM, Dhaka zone table  | A free key with enough quota for a demo. The fallback keeps the app working on an evaluator's machine with no key (NFR-13).                                                                                                                                   | Quota limits: self-host OSRM.                                                                                  |
| Logging        | pino + pino-http                             | winston, morgan         | Structured JSON with a request id on every line, and header-free entries so cookies never reach the logs (NFR-42/43).                                                                                                                                         | A hosted log pipeline with its own agent.                                                                      |
| Passwords      | bcryptjs                                     | bcrypt (native), argon2 | The bcrypt algorithm (NFR-7) in pure JS, so the Alpine images need no native build step.                                                                                                                                                                      | Login throughput: switch to native bcrypt or argon2.                                                           |
| Hosting        | Vercel, Render (Singapore), Neon (Singapore) | Railway, Fly.io         | All free tiers. The API and database share a region, which keeps query latency low.                                                                                                                                                                           | Free-tier sleep becomes unacceptable.                                                                          |
| CI             | GitHub Actions                               | —                       | Runs format, lint, typecheck, build and tests against a Postgres service on every PR (NFR-30).                                                                                                                                                                | —                                                                                                              |

Version pins worth knowing: TypeScript is held at 6.0 because typescript-eslint doesn't
support TypeScript 7 yet. ESLint is held at 9 because Next's lint plugins don't support
ESLint 10 yet.

**Money** is stored as `DECIMAL(10,2)` and handled with decimal arithmetic, never floats. It
travels over the API as strings like `"116.00"`. We chose decimal taka over integer poysha
because the fare formula multiplies by factors like 1.05 and 1.15. Keeping full precision
until one final half-up rounding (FR-F5) makes every fare checkable by hand.

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

| Variable                                            | Used by     | Purpose                                                           |
| --------------------------------------------------- | ----------- | ----------------------------------------------------------------- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | compose     | Database credentials; compose also builds the API's URL from them |
| `POSTGRES_PORT`, `API_PORT`, `WEB_PORT`             | compose     | Host ports                                                        |
| `DATABASE_URL`                                      | api         | Postgres connection string (`postgres://…`)                       |
| `PORT`                                              | api         | HTTP port, default 4000                                           |
| `NODE_ENV`                                          | api         | `development` turns on pretty logs                                |
| `LOG_LEVEL`                                         | api         | pino level, default `info`                                        |
| `SESSION_SECRET`                                    | api         | Signs the login cookie; at least 32 characters. Required.         |
| `COOKIE_SECURE`                                     | api         | `Secure` cookie flag; defaults to on when `NODE_ENV=production`   |
| `TEST_DATABASE_URL`                                 | api tests   | Separate test database, created automatically if missing          |
| `API_URL`                                           | web (build) | Where the proxy sends `/api/v1/*`. It's read at **build** time.   |

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

CI runs the same steps on every pull request. Tests never call the real map service. The
concurrency tests (from phase 4) will run against a real database and repeat many times
(NFR-28).

Covered so far:

- Liveness and readiness, including a 503 when the database is unreachable
- The error envelope for unknown routes and malformed JSON
- Request-id generation and safe propagation
- Seed idempotency and password hashing, plus every cast wallet and Jashim's Bullet
- Sign-up rules: required gender, a Tesla for drivers only, seat limits, one transaction
- Ten simultaneous sign-ups with one email, five rounds: exactly one account each time
- Sign-in: a wrong password and an unknown email get the same answer
- Sessions: missing, tampered, foreign-secret and expired tokens get 401; the wrong role gets 403

## Demo credentials

Every seeded account uses the password **`TeslaPool#2026`**.

| Name   | Email                 | Role      | Gender |
| ------ | --------------------- | --------- | ------ |
| Jashim | jashim@teslapool.test | driver    | male   |
| Nusrat | nusrat@teslapool.test | passenger | female |
| Rafiq  | rafiq@teslapool.test  | passenger | male   |
| Shirin | shirin@teslapool.test | passenger | female |

Sign in at http://localhost:3000/login. Jashim drives the Tesla "Bullet" (3 seats). Every
wallet starts at ৳ 0.00; top-ups arrive with TeslaPay in phase 6.

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

Every error has the same shape (NFR-35):

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [] } }
```

Every response carries an `X-Request-Id` header, and the same id appears on that
request's log line (NFR-42).

## Assumptions

- **Seed genders.** The brief doesn't give genders. We assume Nusrat and Shirin are female
  and Jashim and Rafiq are male, so a same-gender pool can be demonstrated.
- **Demo password.** One shared, published password for all seeded accounts. They are
  demo accounts, not secrets.
- **Seat limit.** A Tesla has 1 to 6 passenger seats. The largest model, the Model X,
  seats 6 besides the driver.
- **Wallets start empty.** Balances stay at ৳ 0.00 until the TeslaPay ledger exists
  (phase 6), so every taka in a wallet is backed by a ledger entry (NFR-39).

## Known limitations

See [NFR §11](docs/Dhaka_Tesla_Pool_Non_Functional_Requirements.md#11-known-limitations) for
the full list. Specific to the current state:

- Next.js resolves the API proxy address at build time. The web image has to be rebuilt to
  point at a different API.
- Signing out clears the cookie, but sessions are stateless. A token copied before
  sign-out keeps working until its 24 hours are up.
- drizzle-kit, a dev-only tool, pulls in an old esbuild that `npm audit` flags. It never
  reaches the Docker images.

## Still to come

- Features implemented, screenshots, API details per phase (phases 1–8)
- Deployment URL (phase 9)
- Viral-scale design (HLD)
- AI Usage
- Demo video
