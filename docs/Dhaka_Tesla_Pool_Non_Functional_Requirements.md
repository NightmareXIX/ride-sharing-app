# Dhaka Tesla Pool — Non-Functional Requirements

**Status:** Draft v3

**Changes from v2:** speed times are now targets rather than guarantees; the straight-line fallback is used only when the map service can't give an answer, not when it is slow; a driver's request-list refresh checks at most 3 new requests against their route.

Functional requirements describe *what* the app does. This document describes *how well* it does it: how fast, how safe, how reliable, and how easy it is to maintain.

All targets are sized for a small demo app. How the system would grow to millions of users is covered separately in the high-level design (HLD).

---

## 1. Where the app runs

| Part | Where |
|---|---|
| Website (Next.js) | Vercel, free tier |
| Server (Node.js API) | Render, free tier, Singapore |
| Database (PostgreSQL) | Neon, free tier, Singapore |
| Maps and road distances | OpenStreetMap for the map; OpenRouteService for road distances (free, limited number of requests per day) |
| Running locally | One command, `docker compose up`, starts the website, server and database |

The server and database are in the same region so they can talk to each other quickly.

The browser only talks to the website. The website passes API calls on to the server behind the scenes, so the browser treats everything as one site. This keeps login cookies working across the two hosts.

---

## 2. Speed

The times below are **targets**, not guarantees. This is a demo running on free hosting with a free map service, so some actions may be slower than their target. When that happens, the app waits for the correct answer rather than taking a shortcut: a slow map service is not a reason to switch to the straight-line estimate (see NFR-13).

| ID | Requirement |
|---|---|
| NFR-1 | Actions that don't need a new road distance aim to respond in under 0.3 seconds (for 95 out of 100 requests). |
| NFR-2 | Actions that need a new road distance aim to respond within 4 seconds. These are: getting a fare estimate, accepting a ride, and a driver's request-list refresh that has to check a new request against their route. If the map service is slower than that, the app keeps waiting for it, up to 10 seconds per map request. After 3 seconds the screen shows a "calculating route…" message. |
| NFR-3 | The app checks for updates every 4 seconds, counted from when the previous check finished, so slow checks never pile up. The target is for a new ride request to appear for drivers, and a status change to appear for the passenger, within 5 seconds. For a driver who already has passengers, each refresh runs the full route check on at most 3 new requests, oldest first. Requests that have been checked before don't count toward this limit. Any others wait for the next refresh, so they may appear a few seconds late. |
| NFR-4 | The first page aims to appear within 2.5 seconds on a typical mobile 4G connection (once the server is awake). |

**How we keep it fast:**

- Road distances are calculated once and saved, not recalculated on every screen refresh.
- Screens that refresh every few seconds read saved data. The one exception is a driver's request list, which may ask the map service about a new request; the 3-request limit in NFR-3 keeps this small.
- Before asking the map service, the driver's request list rules out requests using quick checks that need no map: free seats, solo and same-gender rules, and straight-line distance from the route. Only requests that might fit are checked with road distances.
- The database has indexes on the data it looks up most often.
- Slow work (map lookups, fare maths) happens before the database locks anything.

Saving results also keeps us within the map service's free limits.

**Why the limit is 3 requests per refresh:** a Bullet that already has passengers has at most 2 free seats, so a few candidates are enough for the driver to choose from, and one refresh never makes more than 3 map requests. The demo cast has three passengers, so the limit is never reached in the demo; it only matters under load.

---

## 3. Security

| ID | Requirement |
|---|---|
| NFR-5 | The live app is only reachable over HTTPS (encrypted connection). |
| NFR-6 | Logging in keeps the user signed in for 24 hours. The login is stored in a secure cookie that page scripts can't read. |
| NFR-7 | Passwords are stored scrambled (hashed with bcrypt), never as plain text. |
| NFR-8 | The server checks every request: who the user is, their role (passenger or driver), and whether the thing they're touching belongs to them. Someone else's ride shows up as "not found." |
| NFR-9 | A passenger never sees another passenger's details or fare, even when they share a Tesla. A driver sees the pickup and destination of requests they're allowed to accept. |
| NFR-10 | All input is checked before it's used. Bad input gets a clear error explaining what's wrong. |
| NFR-11 | Secret values (passwords, keys, database addresses) live only in environment settings, never in the code or the browser. |
| NFR-12 | Database queries are built safely, so user input can't be used to run unintended database commands. |

---

## 4. Reliability

| ID | Requirement |
|---|---|
| NFR-13 | The app uses the straight-line estimate (straight-line distance × 1.3) only when the map service can't give an answer: it is down or returns an error, the free requests have run out, no key is set up, or it hasn't answered within 10 seconds. Being slower than the 4-second target is not a reason to fall back. The fare breakdown records which method was used. This means the app works anywhere, including an evaluator's machine without our key. |
| NFR-14 | Actions with several steps (e.g. completing a ride, charging the wallet and paying the driver) either finish completely or not at all. |
| NFR-15 | The server has two health checks: one confirms the server is running, the other also confirms the database is reachable. Locally, the server starts only after the database is ready. |
| NFR-16 | When the server shuts down, it finishes the requests it's already handling first. |
| NFR-17 | There is no uptime guarantee, since hosting is free. Free servers sleep when idle, so if the app takes more than 3 seconds to respond on first load, it shows a "waking up the server" message. |

---

## 5. Capacity

| ID | Requirement |
|---|---|
| NFR-18 | The app handles 25 people using it at once (5 drivers and 20 passengers), about 7 requests per second, while aiming to meet the speed targets. This number comes from 5 full Bullets (15 riders) plus a few passengers waiting. A load-test script checks it. |
| NFR-19 | The server doesn't keep anything important in its own memory between requests. More copies of the server could be added later without changing the code. |
| NFR-20 | Protection against double-booking (e.g. two passengers grabbing the last seat) is enforced by the database. It still works if several copies of the server are running. |

---

## 6. Usability

| ID | Requirement |
|---|---|
| NFR-21 | Every screen works on both phones and laptops. |
| NFR-22 | Every screen shows a clear state while loading, when there's nothing to show, and when something goes wrong. Errors are shown in plain words, never as raw technical output. |
| NFR-23 | Money is shown as "৳ 116.00". Times are shown in Dhaka time. The app is in English. |
| NFR-24 | The map shows the OpenStreetMap credit, as its license requires. |

---

## 7. Code quality and testing

| ID | Requirement |
|---|---|
| NFR-25 | TypeScript is used on both the website and the server. |
| NFR-26 | The code is organized in clear layers. The fare and matching logic are kept separate so they're easy to test and explain. |
| NFR-27 | These cases must have tests: Bullet's seat limit is never exceeded; invalid status changes are blocked; Nusrat's and Rafiq's fares calculate correctly; users can't change someone else's ride; cancellation and fine rules hold; and when two people try to grab the last seat at the same moment, exactly one succeeds. |
| NFR-28 | Tests for simultaneous actions run against a real database and are repeated many times, since timing problems don't always show up on the first try. Tests never use the real map service. |
| NFR-29 | There is no code-coverage percentage target. The focus is on testing the risky behaviour listed above. |
| NFR-30 | Every pull request automatically runs code checks and all tests on GitHub. |
| NFR-31 | Database changes are made through versioned migration files. Demo data loads automatically and is safe to load more than once. |
| NFR-32 | The app works on the latest versions of Chrome, Firefox, Safari and Edge, and on phone browsers (Chrome on Android, Safari on iPhone). |
| NFR-33 | The README, architecture diagram and database diagram are kept up to date as the code changes. |

---

## 8. API rules

| ID | Requirement |
|---|---|
| NFR-34 | All API addresses start with `/api/v1`. |
| NFR-35 | Every error has the same format: an error code, a readable message, and optional details. |
| NFR-36 | Long lists (ride history, earnings) are returned in pages. |
| NFR-37 | Tapping a button twice doesn't create duplicates, such as two ride requests or two accepts. |

Error status codes:

| Code | Meaning |
|---|---|
| 400 | The input is invalid |
| 401 | Not logged in |
| 403 | Wrong role (e.g. a passenger trying a driver action) |
| 404 | Not found, or not yours |
| 409 | Someone else got there first, or the action isn't allowed in the ride's current state |
| 422 | A business rule blocks it (e.g. not enough wallet balance) |

---

## 9. Data and time

| ID | Requirement |
|---|---|
| NFR-38 | Times are stored in UTC and shown in Dhaka time. Time limits (3-minute free cancellation, 5-minute no-show wait) are measured by the database's clock, never the user's phone. |
| NFR-39 | Wallet history can only be added to, never edited or deleted. The database itself enforces this. Mistakes are fixed by adding a correcting entry. |
| NFR-40 | Ride history, status history and wallet history are kept permanently. |
| NFR-41 | Once a distance, trip reading or fare is recorded, it is never changed or recalculated. |

---

## 10. Logging

| ID | Requirement |
|---|---|
| NFR-42 | Every request is logged with a unique ID, what was requested, the result and how long it took. The same ID is sent back in the response so a problem can be traced. |
| NFR-43 | Passwords, login tokens and secret values are never written to logs. |
| NFR-44 | Blocked actions, "someone got there first" conflicts, map-service fallbacks and map requests slower than the 4-second target are logged as warnings. Server crashes are logged as errors with full details. |

---

## 11. Known limitations

- There's no limit on login attempts, so passwords could be guessed by brute force.
- Free hosting sleeps when idle, so the first visit after a quiet period is slow.
- Updates arrive by checking every 4 seconds, so there is usually up to a 5-second delay.
- When the map service is slow, fare estimates, accepts and some driver refreshes can take up to about 10 seconds.
- A new ride request can take a few extra seconds to reach a driver who already has passengers, if it needs a new route check or more than 3 new requests arrive at once.
- Accessibility (screen readers, keyboard-only use) is not covered. Choosing locations needs a mouse or touch.
- Encryption of stored data depends on the database provider's defaults.
- When the map service can't give an answer, distances are approximate.

---

## 12. Left for the scaling discussion (HLD)

- Redis for finding nearby drivers, caching, and sending live updates
- Instant updates (WebSockets or similar) instead of checking every 4 seconds
- Limiting how often users can make requests
- Monitoring dashboards and automatic alerts
- Running many server copies, spreading load between them, and scaling the database
