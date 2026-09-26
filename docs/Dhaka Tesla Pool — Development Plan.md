# Dhaka Tesla Pool — Development Plan

Sep 24, 2026 · @Sadnan

## Purpose

We build Dhaka Tesla Pool in 10 phases: a foundations phase, eight feature phases, and a release phase. Each feature phase adds one working piece of the app on top of the last one.

The plan follows the RoBenDevs PRD and our own specs:

- Functional Requirements
- Non-Functional Requirements
- Core Entities (with ERD)
- API Routes
- Architecture Diagram

The most important parts come first. If time runs short, later phases can be reduced without breaking what the PRD asks us to test.

## Tech stack

Most of the stack is already fixed by the PRD or our specs. The remaining choices are made in phase 0 and justified in the README, as the PRD requires.

**Decided**

| Part | Choice | Comes from |
| --- | --- | --- |
| Language | TypeScript on frontend and backend | NFR-25 |
| Frontend | Next.js (App Router) | PRD |
| Backend | Node.js with Express | PRD, our choice |
| Database | PostgreSQL | Our choice (NFR, Core Entities) |
| Map | OpenStreetMap | FR-L1 |
| Road distances | OpenRouteService, with straight-line × 1.3 as fallback | FR-L2, NFR-13 |
| Sign-in | Email and password, bcrypt hashing, 24-hour secure cookie | NFR-6, NFR-7 |
| Local run | Docker Compose (website, API, database) | PRD, NFR §1 |
| CI | GitHub Actions (checks and tests on every pull request) | NFR-30 |
| Hosting | Vercel (website), Render Singapore (API), Neon Singapore (database) | NFR §1 |

**To decide in phase 0**

| Part | Options |
| --- | --- |
| ORM / query builder | Prisma, Drizzle, Kysely |
| Input validation | Zod, Joi |
| Testing | One simple test runner (Jest or Vitest) with plain tests; no extra testing tools |
| Map component | Leaflet (react-leaflet), MapLibre |
| Styling | Tailwind CSS, CSS Modules |

The ORM must support conditional updates and transactions, since seat capacity and state changes depend on them (FR-C1 to FR-C7).

## Development strategy

Every feature phase goes through the same four steps, in this order:

1. **Design the LLD.** Decide the details for this phase only: tables and columns, request and response shapes, and the rules the code must follow.
2. **Build the backend.** Implement the phase according to its LLD.
3. **Build the frontend.** Build screens for this phase's backend features only. Add more only if it is really needed.
4. **Test it.** Check that the phase works and that the rules in the specs hold.

A phase is done when all four steps are finished and the work is merged into `master`. The next phase starts only after that.

## Git flow

The PRD grades our git history, so we follow its branch flow from the first day.

| Branch | Used for |
| --- | --- |
| `feature/*` | One branch per phase (or per part of a phase). Small, clear commits. |
| `master` | Receives a feature branch once it works and its tests pass. |
| `pre-release` | Cut from `master` after the feature phases. Used for fixes, docs and deployment checks. |
| `release/v1.0.0` | Cut from `pre-release`. The version shown in the video and deployment. |

Commit messages use the format `<type>(<scope>): <short description>`, for example `feat(pool): enforce Bullet's seat capacity`. Nothing is pushed directly to `master`.

## Phases

The phases are built in this order. Phases 0 to 4 cover everything the PRD asks us to test, so they come first.

| # | Phase | What it covers | Branch |
| --- | --- | --- | --- |
| 0 | Foundations | Repo and branches, project folders, Docker Compose with Postgres, migrations, seed data with the story cast, health checks, CI | `feature/project-setup` |
| 1 | Accounts | Sign up, sign in, sign out, roles, a wallet for every user, `/me` | `feature/auth` |
| 2 | Requesting a ride | Driver's Tesla, online/offline and location; road distance with fallback; fare estimate; passenger creates and cancels a request | `feature/ride-request` |
| 3 | Single ride lifecycle | Driver sees nearby requests and accepts one; arrive, start, complete; status history; final fare paid in cash; driver cancel | `feature/driver-flow` |
| 4 | Seats and concurrency | Seat limit on Bullet; only one driver can claim a request; last-seat race (Nusrat vs Shirin); one active ride per passenger | `feature/seat-capacity` |
| 5 | Pooling | Route stops and odometer; matching rule; shared km in the fare; Nusrat and Rafiq's shared trip | `feature/tesla-pooling` |
| 6 | TeslaPay and fines | Top-up, balance checks, pay and credit on completion, wallet history, late-cancel fine, no-show, driver penalty | `feature/teslapay` |
| 7 | Ride options | Solo ride and same-gender pool | `feature/ride-options` |
| 8 | History and earnings | Passenger ride history with fare breakdown, driver trip history and earnings | `feature/history` |

Phase 0 has no LLD or frontend step. It sets up the base that every other phase builds on.

## Release (phase 9)

After the feature phases, we cut `pre-release` and finish the project for submission.

- Deploy to Vercel, Render and Neon (free tiers only)
- Fix bugs found during integration and deployment
- Complete the README with all sections the PRD lists, including demo credentials, AI Usage, known limitations and next improvements
- Update the architecture diagram and ERD to match the code
- Write the viral-scale (HLD) section, if time allows
- Cut `release/v1.0.0` from `pre-release`
- Record the 6-minute video and link it in the README
- Go through the PRD submission checklist

## Changes to the plan

Work added after the plan was written. Each entry says what changed and why.

### Demo accounts (after phase 8)

- **What:** The home page now has a **Try the demo** section with one button for each seeded account: Jashim the driver, and the passengers Nusrat, Rafiq and Shirin. Tapping a button signs you in as that person. The sign-in page shows the same buttons under the form.
- **Why:** Anyone, including an evaluator, can try the app straight away, without signing up or copying passwords from the README.
- **How:** The buttons use the normal sign-in, with the demo passwords the README already publishes. Nothing changed on the server.
- **Branch:** `feature/demo-accounts` (pull request #10)
