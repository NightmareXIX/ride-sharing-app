# Dhaka Tesla Pool — Functional Requirements

**Status:** Draft v1 (functional scope only; non-functional requirements to follow)
**Source:** RoBenDevs internship PRD + design decisions agreed after review

---

## 1. Actors and glossary

| Term | Meaning |
|---|---|
| **Passenger** | A user who requests rides (seed: Nusrat, Rafiq, Shirin). |
| **Driver** | A user who owns one Tesla and accepts ride requests (seed: Jashim). |
| **Tesla / vehicle** | A driver's vehicle with a fixed seat capacity (seed: Bullet, 3 seats). |
| **Booking** | One passenger's ride request and its lifecycle. Each booking has its own status and fare. |
| **Pool** | The container grouping all bookings served by one Tesla on one continuous trip. |
| **Remaining route** | The ordered path from the driver's current position through all pending pickups and drop-offs. |
| **Route odometer** | Cumulative km along a pool's route; recorded at every pickup and drop-off. |
| **Shared km** | Distance of a passenger's trip during which at least one *other booking* was on board. |

---

## 2. Key constants

| Constant | Value |
|---|---|
| Base fare | 30 tk |
| Distance rate | 20 tk/km |
| Pool discount | 40% of the distance charge on shared km (= 8 tk per shared km) |
| Extra seat price | 50% of the fare per additional seat |
| Same-gender pool surcharge | +5% |
| Solo ride surcharge | +15% |
| Maximum detour | 1 km per existing passenger |
| Idle-driver search radius | Configurable (default 2 km) |
| Free cancellation window | 3 minutes after acceptance |
| No-show wait | 5 minutes after driver arrival |
| Passenger fine (late cancel / no-show) | 30 tk |
| Money representation | DECIMAL(10,2), decimal arithmetic, half-up rounding to 2 dp applied once to the final fare |

---

## 3. Passenger

| ID | Requirement |
|---|---|
| FR-P1 | A passenger can sign up with name, credentials and gender. Gender is required. |
| FR-P2 | A passenger can sign in. |
| FR-P3 | A passenger can request a ride by setting on the map: pickup location (set manually), destination, number of seats (1 to vehicle maximum), payment method (Cash or TeslaPay) and ride option (Pool, Same-gender pool, or Solo). |
| FR-P4 | A passenger sees the estimated fare before confirming the request. The final fare never exceeds the estimate. |
| FR-P5 | A passenger can track the status of their own booking: waiting (REQUESTED) → matched (ACCEPTED / DRIVER_ARRIVED) → in progress (STARTED) → completed (COMPLETED) or cancelled (CANCELLED). |
| FR-P6 | A passenger can view their ride history, including the fare breakdown of each ride. |
| FR-P7 | A passenger can cancel a booking before it is STARTED. Cancellation is free before acceptance and within 3 minutes after acceptance; after that a 30 tk fine applies. Cancellation after STARTED is not allowed. |
| FR-P8 | A passenger sees only their own fare and status, never those of other passengers in the pool. |
| FR-P9 | A passenger cannot view or modify another user's booking. |
| FR-P10 | A passenger can have at most one active booking at a time. |
| FR-P11 | On completion, a passenger sees the final fare with its breakdown: pickup and drop-off odometer readings, total km, shared km, seats, ride option, and the calculation steps. |

---

## 4. Driver

| ID | Requirement |
|---|---|
| FR-D1 | A driver can sign up and register exactly one Tesla with a name and a fixed seat capacity. |
| FR-D2 | A driver can sign in. |
| FR-D3 | A driver can go online and offline. A driver cannot go offline while they have any active booking. |
| FR-D4 | A driver sets their current location manually on the map. |
| FR-D5 | Only online drivers see ride requests. |
| FR-D6 | An idle driver (no active bookings) sees open requests whose pickup is within the configured search radius. Solo requests are shown only to idle drivers. |
| FR-D7 | A driver with active bookings sees only requests that pass the matching rule (FR-L3), fit the free seats, and satisfy same-gender constraints (FR-R10). While a solo booking is active, the driver sees no requests. |
| FR-D8 | A driver chooses which requests to accept from the list. The system does not auto-assign. |
| FR-D9 | A driver can accept new passengers after the ride has started, subject to FR-D7. |
| FR-D10 | For each passenger individually, a driver can mark arrival at pickup, start the trip (passenger picked up), and complete the trip (passenger dropped off). |
| FR-D11 | A driver can mark a passenger as a no-show when at least 5 minutes have passed since arrival. The booking is cancelled and the passenger is fined 30 tk. |
| FR-D12 | A driver can cancel an accepted booking before it is STARTED. The passenger's request is re-surfaced (returns to REQUESTED) and becomes visible to drivers again. |
| FR-D13 | If a driver cancels more than 3 minutes after acceptance, a penalty record is stored against the driver. The consequence of the penalty is to be defined later. |
| FR-D14 | A driver can see every passenger assigned to the pool, the seats each holds, and each passenger's individual status. |
| FR-D15 | A driver can view their ride history and earnings. |

---

## 5. Ride / Pool

| ID | Requirement |
|---|---|
| FR-R1 | Multiple bookings can share one Tesla when they pass the matching rule (FR-L3). |
| FR-R2 | The total seats of all accepted and on-board bookings in a Tesla never exceed its capacity. |
| FR-R3 | When several accepts compete for the last seat(s), exactly one succeeds; the others receive a clear conflict error and no data changes. |
| FR-R4 | A request can be accepted by at most one driver. If two drivers accept the same request, one succeeds and the other receives an error. |
| FR-R5 | Each passenger gets an individual fare. |
| FR-R6 | It is always clear which bookings belong to which pool. |
| FR-R7 | Each booking follows the state machine in Section 6. A pool is ACTIVE while any of its bookings is not in a final state, and FINISHED once all are COMPLETED or CANCELLED. |
| FR-R8 | Any transition not listed in Section 6, or attempted by an actor not permitted to perform it, is rejected and nothing is changed. |
| FR-R9 | Time windows (3-minute free cancellation, 5-minute no-show) are measured using server time, never the client's clock. |
| FR-R10 | A Solo booking locks the Tesla: no other booking can join while it is active. A Same-gender booking only shares with passengers of the same gender, and any passenger joining later must match. The driver's gender is not considered. |
| FR-R11 | The system keeps a status history for every booking: from-state, to-state, actor, timestamp and reason (e.g. `late_cancel`, `no_show`, `driver_cancel`). |

---

## 6. Booking state machine

| From | To | Actor | Condition / effect |
|---|---|---|---|
| REQUESTED | ACCEPTED | Driver | Matching, detour, seat and gender checks pass |
| REQUESTED | CANCELLED | Passenger | Always free |
| ACCEPTED, DRIVER_ARRIVED | CANCELLED | Passenger | Free within 3 min of acceptance; otherwise 30 tk fine |
| ACCEPTED, DRIVER_ARRIVED | REQUESTED | Assigned driver | Driver cancel; seats released; request re-surfaced; penalty record if more than 3 min after acceptance |
| ACCEPTED | DRIVER_ARRIVED | Assigned driver | — |
| DRIVER_ARRIVED | CANCELLED | Assigned driver | No-show; allowed at least 5 min after arrival; 30 tk fine to passenger |
| DRIVER_ARRIVED | STARTED | Assigned driver | Passenger picked up; odometer recorded |
| STARTED | COMPLETED | Assigned driver | Passenger dropped off; odometer recorded; fare calculated and settled |
| COMPLETED, CANCELLED | — | — | Final states; no further transitions |

Examples of rejected transitions: REQUESTED → STARTED (skips steps), COMPLETED → STARTED (leaves a final state), STARTED → CANCELLED (cancellation after pickup), a passenger marking their own ride as started, or a driver acting on another driver's booking.

---

## 7. Location and matching

| ID | Requirement |
|---|---|
| FR-L1 | Maps are displayed with OpenStreetMap. Routes and road distances come from a free routing service (OpenRouteService or OSRM). |
| FR-L2 | Fallback: if the routing service is unavailable, distance is straight-line (haversine) distance × 1.3; alternatively the predefined Dhaka zone model is used (Banani, Gulshan, Mohakhali, Dhanmondi, Mirpur, Uttara, Farmgate, Bashundhara, etc.). |
| FR-L3 | **Matching rule.** A request can join an active pool only if all of the following hold: (a) its pickup lies ahead on the driver's remaining route; (b) its destination lies on the remaining route after the pickup, or the route's current end lies on the path to the destination (the route may extend but not branch), except for small detours allowed by (c); (c) any detour adds at most 1 km to each existing passenger's trip; (d) no passenger's projected fare exceeds their estimate, which reduces to `detour ≤ 0.4 × sharedKm` for each affected passenger; (e) enough seats are free; (f) solo and same-gender constraints are met. |
| FR-L4 | Nusrat's (Banani → Mohakhali) and Rafiq's (Banani → Gulshan 1) requests produce a defined, documented result under FR-L3. |
| FR-L5 | When a route is set or changed, the planned cumulative km (odometer) to each stop is stored. The actual odometer reading is recorded at each pickup and drop-off. Stored distances are never recomputed later. |

---

## 8. Fare

| ID | Requirement |
|---|---|
| FR-F1 | `seatMultiplier = 1 + 0.5 × (seats − 1)` — 1 seat ×1.0, 2 seats ×1.5, 3 seats ×2.0. A passenger's own seats do not count as sharing. |
| FR-F2 | `optionMultiplier` = 1.00 (Pool), 1.05 (Same-gender pool), 1.15 (Solo). |
| FR-F3 | `estimate = (30 + 20 × directKm) × seatMultiplier × optionMultiplier`, where `directKm` is the routed distance from pickup to destination at request time. |
| FR-F4 | `computedFare = (30 + 20 × actualKm − 8 × sharedKm) × seatMultiplier × optionMultiplier`, where `actualKm = dropOffOdometer − pickupOdometer`. |
| FR-F5 | `finalFare = min(computedFare, estimate)`, rounded half-up to 2 decimal places once. |
| FR-F6 | Every fare can be verified by hand from its stored breakdown. |

**Worked examples**

| Case | Calculation | Final fare |
|---|---|---|
| Pool, 1 seat: direct 5 km, rides 5.5 km, shares 3 km | Estimate 30 + 100 = 130. Computed 30 + 110 − 24 = 116. Detour 0.5 ≤ 1 ✓, 0.5 ≤ 0.4 × 3 = 1.2 ✓ | 116.00 |
| Same trip, 2 seats | 116 × 1.5 | 174.00 |
| Same trip, 2 seats, same-gender | 116 × 1.5 × 1.05 | 182.70 |
| Solo, 5 km, 1 seat | (30 + 100) × 1.15 | 149.50 |

---

## 9. Payments and wallet (TeslaPay)

| ID | Requirement |
|---|---|
| FR-W1 | Every user has a TeslaPay wallet with a balance. |
| FR-W2 | A passenger can top up their wallet with simulated money (no real payment gateway). |
| FR-W3 | A TeslaPay request is allowed only if the passenger's balance is at least the estimated fare. |
| FR-W4 | On completion of a TeslaPay booking, the final fare is deducted from the passenger's wallet and credited to the driver's wallet. |
| FR-W5 | On completion of a Cash booking, the fare is recorded as driver earnings only. No wallet balance changes. |
| FR-W6 | Passenger fines (late cancellation, no-show) are always deducted from the wallet, regardless of payment method, and may take the balance below zero. A negative balance can only result from a fine. |
| FR-W7 | While a passenger's balance is negative, they cannot create any new ride request (Cash or TeslaPay) until they top up to zero or above. |
| FR-W8 | Every money movement (top-up, fare debit, driver credit, cash earning, fine) is recorded in an append-only wallet transaction ledger. |

---

## 10. Data consistency guarantees

These are functional guarantees; the implementation approach is noted for traceability.

| ID | Guarantee | Planned approach (PostgreSQL) |
|---|---|---|
| FR-C1 | Seat capacity is never exceeded, even under concurrent accepts. | Atomic conditional update on the vehicle row (`occupied_seats + :seats <= capacity`) plus `CHECK (occupied_seats BETWEEN 0 AND capacity)` as a database backstop. |
| FR-C2 | A request is claimed by at most one driver. | Conditional update `WHERE status = 'REQUESTED'`; 0 rows affected → 409 Conflict. |
| FR-C3 | Accepts computed against an outdated view of the pool are rejected. | Optimistic `version` column on the vehicle/pool, checked in the same update; routing and fare checks happen before the transaction. |
| FR-C4 | Every status transition is atomic and applies only from the expected state. | `UPDATE … WHERE id = ? AND status = <expected>` for every transition, with the history row written in the same transaction. |
| FR-C5 | A repeated accept by the same driver (double tap / retry) does not create an error or duplicate. | If the booking is already accepted by that driver, return the existing result. |
| FR-C6 | A passenger cannot hold two active bookings. | Partial unique index on `bookings(passenger_id)` for active states. |
| FR-C7 | Fare settlement, wallet movements and ledger entries succeed or fail together. | Single transaction; consistent row-lock ordering (vehicle → booking → wallets) to avoid deadlocks. |

---

## 11. Seed / demo data

| ID | Requirement |
|---|---|
| FR-S1 | Seed data uses the story cast: Jashim (driver), Bullet (3 seats), Nusrat, Rafiq and Shirin (passengers). No generic placeholder names. |
| FR-S2 | Demo credentials for all seeded users are documented. |
| FR-S3 | Seeded wallets, genders and coordinates make it possible to demonstrate: a pooled ride, the last-seat race, a same-gender pool, a solo ride, a late-cancellation fine and a no-show. |

---

## 12. Out of scope

- Traffic charges; discounts based on the number of co-riders; surge pricing; promo codes; refunds and disputes
- Real payment gateway and real-money top-ups
- Live GPS tracking and automatic location updates; turn-by-turn navigation; a self-hosted routing engine
- Automatic driver assignment / dispatch
- Automatic (scheduler-based) no-show cancellation — the driver triggers it and the server validates the time
- Ratings; general audit log (logins, profile edits)
- Gender verification; gender-based driver matching
- Scheduled / future rides; more than one vehicle per driver
- Push, SMS or email notifications; passenger–driver chat or calls
- Admin panel; driver verification / KYC
- Password reset; email or phone verification

---

## 13. Deferred to later discussion / LLD

- **Driver penalty consequences:** penalty records are stored (FR-D13); what they trigger is to be defined.
- **"Stop searching" option:** a way for a passenger whose request was re-surfaced after a driver cancellation to stop searching; to be defined in the LLD.
- **Nusrat / Rafiq pooling result:** whether they pool depends on real routed distances under FR-L3; to be verified once routing is integrated, and seed coordinates adjusted if the demo needs them to pool.
- **Seed genders:** the story does not state genders; seed values will be assigned and documented as an assumption.
