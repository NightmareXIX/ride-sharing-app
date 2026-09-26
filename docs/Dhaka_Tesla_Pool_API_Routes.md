# Dhaka Tesla Pool — API Routes

**Status:** Draft v2 (simplified)

This document lists every route in the API and what it does. Exact request and response formats are left for the LLD.

---

## 1. Basics

- All routes start with `/api/v1` (except the health checks).
- Logging in sets a secure cookie that keeps the user signed in for 24 hours.
- Passengers and drivers have separate routes. Calling a route meant for the other role returns **403**.
- A user can only see their own data. Anything that belongs to someone else returns **404**.
- Money is sent as text with two decimals, e.g. `"116.00"`, never as a float.
- Times are sent in UTC. The app shows them in Dhaka time.
- Long lists are split into pages: `?cursor=...&limit=...`
- Every error looks the same: `{ "error": { "code": "...", "message": "..." } }`
- Pressing a button twice is safe. If the action already happened, the route returns the current result instead of an error.

---

## 2. Health checks

| Method | Route | What it does |
|---|---|---|
| GET | `/health` | Confirms the server is running. |
| GET | `/health/ready` | Confirms the server is running and can reach the database. |

---

## 3. Account (everyone)

| Method | Route | What it does |
|---|---|---|
| POST | `/auth/signup` | Creates an account and a wallet. Needs name, email, password, gender and role. A driver also sends their Tesla's name and seat count. |
| POST | `/auth/login` | Logs in with email and password. |
| POST | `/auth/logout` | Logs out. |
| GET | `/me` | Returns the logged-in user's details, role and wallet balance. Also returns the driver's Tesla, or the passenger's current ride. |

---

## 4. Wallet (everyone)

| Method | Route | What it does |
|---|---|---|
| GET | `/wallet` | Shows the wallet balance. |
| GET | `/wallet/transactions` | Lists every money movement, newest first. |
| POST | `/wallet/top-ups` | Adds pretend money to the wallet. Passengers only. |

---

## 5. Passenger: rides

| Method | Route | What it does |
|---|---|---|
| GET | `/nearby-teslas` | Shows the Teslas within 2 km of a pickup that could take a passenger now, as rough anonymous points. For looking only: the passenger can't choose one. |
| POST | `/fare-estimates` | Shows the estimated fare for a trip before booking. Needs pickup, destination, seats and ride option. Nothing is booked. |
| POST | `/bookings` | Requests a ride. Needs pickup, destination, seats, ride option and payment method. |
| GET | `/bookings/current` | Shows the passenger's current ride, or nothing. The app checks this every 4 seconds. |
| GET | `/bookings` | Lists the passenger's past rides. |
| GET | `/bookings/:id` | Shows one ride: its status, driver and Tesla, and the fare breakdown once finished. Never shows other passengers. |
| POST | `/bookings/:id/cancel` | Cancels the ride. Free before a driver accepts and for 3 minutes after. After that, a 30 tk fine. Not allowed once the ride has started. |

**A ride request is refused when:**

- the passenger already has a ride in progress
- the wallet balance is below zero
- TeslaPay is chosen and the balance is less than the estimated fare
- the seat count is not between 1 and the Tesla's seat limit

---

## 6. Driver: Tesla and availability

| Method | Route | What it does |
|---|---|---|
| GET | `/driver/vehicle` | Shows the driver's Tesla: seats, seats taken, online or offline, and location. |
| POST | `/driver/vehicle/online` | Goes online so the driver can see ride requests. |
| POST | `/driver/vehicle/offline` | Goes offline. Not allowed while the driver has passengers. |
| PUT | `/driver/vehicle/location` | Sets the driver's location on the map. Only allowed while the driver has no passengers. |

---

## 7. Driver: finding and accepting rides

| Method | Route | What it does |
|---|---|---|
| GET | `/driver/requests` | Lists ride requests the driver can accept. The app checks this every 4 seconds. |
| POST | `/driver/requests/:bookingId/accept` | Accepts a ride request. Checks everything again before accepting, since things may have changed. |

**Which requests a driver sees:**

| Driver's situation | Requests shown |
|---|---|
| Offline | None |
| Has a solo passenger | None |
| No passengers | Requests with a pickup close by (within 2 km by default). |
| Has passengers | Only requests that fit the current route and have enough free seats. |

**How "fits the current route" is checked:**

1. First, quick checks that don't need the map: free seats, solo and same-gender rules, and whether the pickup is roughly near the route.
2. Then, the full route check using real road distances. Distances already worked out before are reused.
3. At most 3 new requests are checked per refresh, oldest first. Any others are checked on the next refresh.
4. The app waits up to 10 seconds for the map service. Only if it gives no answer does the app use straight-line distance × 1.3 instead.

**Accepting can fail when:**

- another driver accepted the request first
- there are no longer enough free seats
- the route changed while accepting (try again)
- the request no longer fits the route
- the driver is offline

---

## 8. Driver: during the trip

| Method | Route | What it does |
|---|---|---|
| GET | `/driver/pool` | Shows the current trip: every passenger, their seats and status, and the list of stops in order with the next stop marked. The app checks this every 4 seconds. |
| POST | `/driver/bookings/:id/arrive` | Marks that the driver has arrived at this passenger's pickup. |
| POST | `/driver/bookings/:id/start` | Marks that the passenger is in the Tesla. |
| POST | `/driver/bookings/:id/complete` | Marks that the passenger has been dropped off. Calculates the final fare and handles payment. |
| POST | `/driver/bookings/:id/no-show` | Cancels a passenger who didn't turn up. Allowed 5 minutes after arrival. The passenger is fined 30 tk. |
| POST | `/driver/bookings/:id/cancel` | Driver drops the passenger before pickup. The request goes back to other drivers. If more than 3 minutes have passed since accepting, a penalty is recorded against the driver. |

**Rules for these actions:**

- The driver must follow the stops in order. Arrive and complete only work when that passenger's stop is the next one.
- The driver can only act on passengers in their own current trip.

---

## 9. Driver: history

| Method | Route | What it does |
|---|---|---|
| GET | `/driver/pools` | Lists the driver's past trips. |
| GET | `/driver/pools/:id` | Shows one past trip with its passengers and fares. |
| GET | `/driver/earnings` | Shows total earnings, split into cash and TeslaPay. |

---

## 10. Error codes

| Status | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Something in the request is missing or wrong. |
| 401 | `UNAUTHENTICATED` | Not logged in. |
| 403 | `WRONG_ROLE` | A passenger used a driver route, or the other way round. |
| 404 | `NOT_FOUND` | Doesn't exist, or belongs to someone else. |
| 409 | `ALREADY_CLAIMED` | Another driver accepted this request first. |
| 409 | `SEATS_UNAVAILABLE` | Not enough free seats. |
| 409 | `POOL_CHANGED` | The trip changed while accepting. Try again. |
| 409 | `INVALID_TRANSITION` | The action isn't allowed at the ride's current stage. |
| 409 | `OUT_OF_STOP_ORDER` | This passenger's stop isn't the next one. |
| 409 | `ACTIVE_BOOKING_EXISTS` | The passenger already has a ride in progress. |
| 409 | `HAS_ACTIVE_BOOKINGS` | The driver can't go offline with passengers. |
| 422 | `INSUFFICIENT_BALANCE` | Not enough TeslaPay balance for this ride. |
| 422 | `NEGATIVE_BALANCE` | Top up before requesting a ride. |
| 422 | `NO_LONGER_MATCHES` | The request no longer fits the driver's route. |
| 422 | `NO_SHOW_TOO_EARLY` | 5 minutes haven't passed since arrival yet. |
| 422 | `DRIVER_OFFLINE` | Go online before accepting rides. |
