# Phase 8 — History and earnings: Low-Level Design

**Branch:** `feature/history`
**Covers:** FR-P6, FR-P8, FR-P9, FR-P11, FR-D13, FR-D15, FR-F6, FR-W5, FR-W8 · NFR-8, NFR-9, NFR-22, NFR-27, NFR-28, NFR-36, NFR-40, NFR-41

This phase lets a passenger look back at their rides and a driver look back at their trips and what they earned. Everything it shows was stored by earlier phases and can't be changed: each booking, its fare breakdown, its status history, the wallet ledger and the driver's penalties. This phase only reads them. Nothing is worked out again (NFR-41).

---

## 1. Scope

**In**

- `GET /bookings`: a passenger's past rides, newest first, in pages, each with its fare breakdown (FR-P6).
- `GET /driver/pools` and `GET /driver/pools/:id`: a driver's past trips, and one trip with its passengers and fares (FR-D15).
- `GET /driver/earnings`: the driver's total earnings, split into cash and TeslaPay (FR-D15).
- History screens for both roles.

**Already in place**

| What | Since |
|---|---|
| `GET /bookings/:id` with the fare breakdown, the fine, the driver and the Tesla (FR-P11) | Phases 3 and 6 |
| `fares`: every figure of a completed ride's fare, never changed (FR-F6, NFR-41) | Phases 3 and 5 |
| `booking_status_history`: every change with its reason and pool (FR-R11) | Phase 3 |
| `wallet_transactions`: `driver_credit` and `cash_earning` for every completed ride (FR-W4, FR-W5, FR-W8) | Phase 6 |
| `driver_penalties` (FR-D13) | Phase 6 |
| Cursor paging: `?cursor&limit`, `parsePageQuery`, `toPage` (NFR-36) | Phase 6 |

**Left for later phases**

None. This is the last feature phase.

---

## 2. Tables

Migration `0013` adds an order to bookings and trips, so their lists can be paged the same way as the wallet history.

| Change | Why |
|---|---|
| `bookings.seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE` | Insertion order: the cursor of a passenger's history |
| `pools.seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE` | Insertion order: the cursor of a driver's trips |
| Index `bookings (passenger_id, seq)` | Reads one passenger's page |
| Index `pools (vehicle_id, seq)` | Reads one Tesla's page |
| Index `booking_status_history (pool_id)` | Finds the passengers a driver dropped from a trip |

Postgres numbers the rows that already exist when the column is added. A passenger has at most one active booking, and a Tesla at most one active trip. So the order a booking or trip was created in is also the order it ended in.

The cursor stays a number, as in phase 6. A page never skips or repeats a row when new ones are added in front.

---

## 3. Routes

All three lists take `?cursor=…&limit=…`. `limit` is 1 to 50 and defaults to 20. A malformed cursor or limit is `400 VALIDATION_ERROR`.

### `GET /bookings`: passenger only

The passenger's rides that have ended, `COMPLETED` or `CANCELLED`, newest first.

```json
{ "bookings": [ { "id": "…", "status": "COMPLETED", "fare": { "finalFare": "52.02", "…": "…" }, "…": "…" } ], "nextCursor": "MTI" }
```

- Each item is the same `BookingView` as `GET /bookings/:id`: the places, seats, option, payment, times, the driver and Tesla, the fare breakdown once completed, and the fine for a late cancel or a no-show.
- The ride in progress isn't listed. It is at `/bookings/current`.
- A `BookingView` never names or prices another passenger, so the history can't either (FR-P8, NFR-9).
- A driver gets 403. Signed out is 401.

### `GET /driver/pools`: driver only

The trips of the driver's Tesla that have finished, newest first.

```json
{
  "pools": [
    {
      "id": "…",
      "createdAt": "…",
      "finishedAt": "…",
      "passengers": 2,
      "completed": 2,
      "earnings": { "total": "123.44", "cash": "71.42", "teslapay": "52.02" }
    }
  ],
  "nextCursor": null
}
```

- `passengers` counts every entry in the trip: each passenger booking the trip ended, and each drop by the driver (§4).
- `completed` counts the rides that were completed.
- `earnings` sums the final fares of the completed rides, by payment method. An empty sum is `"0.00"`.
- The trip in progress isn't listed. It is at `/driver/pool`.

### `GET /driver/pools/:id`: driver only

One finished trip: the summary above, the Tesla's name, and every passenger.

```json
{
  "pool": {
    "id": "…", "…": "the summary",
    "vehicle": { "name": "Bullet" },
    "bookings": [
      {
        "id": "…",
        "passenger": { "name": "Nusrat" },
        "pickup": { "lat": 23.79, "lng": 90.40, "label": "Banani Road 11" },
        "destination": { "…": "…" },
        "seats": 1,
        "rideOption": "pool",
        "paymentMethod": "teslapay",
        "estimatedFare": "66.70",
        "outcome": "completed",
        "endedAt": "…",
        "fare": { "…": "the breakdown" },
        "penaltyRecorded": false
      }
    ]
  }
}
```

- Entries are in the order they ended.
- The driver sees each passenger's name and fare, as the live trip already shows (FR-D14, API Routes §9). A passenger's gender and fine aren't sent.
- A trip of another driver, a trip that doesn't exist, and the trip still in progress are all `404 NOT_FOUND` (NFR-8).
- A malformed id is `400 VALIDATION_ERROR`, as for bookings.

### `GET /driver/earnings`: driver only

```json
{ "earnings": { "total": "123.44", "cash": "71.42", "teslapay": "52.02", "rides": 2 } }
```

- It covers all time, as API Routes §9 asks.
- The ride-by-ride list is already paged twice: by trip in `/driver/pools`, and by entry in `/wallet/transactions` (NFR-36). This route returns only the totals.

### Error codes added in this phase

None.

---

## 4. Rules

### A trip's passengers

A trip's entries come from two places:

| Entry | Found by | `outcome` | `endedAt` |
|---|---|---|---|
| A booking the trip ended | `bookings.pool_id` is the trip. It is `COMPLETED` or `CANCELLED`, since the trip has finished. | `completed`; for `CANCELLED`, the reason of its last change: `passenger_cancelled` (free), `late_cancel` or `no_show` | `completed_at` or `cancelled_at` |
| A drop by the driver | A history row with reason `driver_cancel` and `pool_id` the trip. A drop empties `bookings.pool_id`, and the history keeps the trip it left (Core Entities). | `driver_cancelled` | The row's `created_at` |

A booking can be dropped, accepted again by the same trip and completed. It then shows twice: once dropped, once completed. That is what happened.

**`penaltyRecorded`.** This is true when a `driver_penalties` row for that driver and booking has the same `created_at` as the drop. The penalty is written in the drop's transaction, and `now()` is fixed for a transaction, so the two times are equal. A penalty therefore belongs to one drop, even when a booking was dropped more than once.

### Earnings

| Figure | Source |
|---|---|
| A trip's earnings | `sum(fares.final_fare)` over the trip's `COMPLETED` bookings, split by `bookings.payment_method` |
| The driver's totals | The ledger: the driver's `cash_earning` entries (cash) and `driver_credit` entries (TeslaPay). `rides` counts them. |

Fines and top-ups never count, and a penalty costs nothing yet (FR §13). Sums are `numeric(12,2)` and sent as strings (API Routes §1).

**The invariant**, checked in the tests: the driver's `earnings.total` = the sum of every trip's `earnings.total` = the sum of the driver's `cash_earning` and `driver_credit` ledger entries. The ride is settled in the transaction that writes its fare (FR-C7), so they can't disagree.

### Where each guarantee lives

| Guarantee | Enforced by |
|---|---|
| A passenger sees only their own rides (FR-P9) | `WHERE passenger_id = me` in the list, as in `GET /bookings/:id` |
| A passenger never sees a co-passenger (FR-P8) | `BookingView` has no field for one |
| A driver sees only their own trips (NFR-8) | The trip is joined to the driver's Tesla. Anything else is 404. |
| History is never recomputed (NFR-41) | Every figure is read from `fares` and the ledger. The `fares` and ledger triggers refuse UPDATE and DELETE. |
| Pages never skip or repeat (NFR-36) | Keyset paging on `seq` |

---

## 5. Configuration

None added.

---

## 6. Code layout

```
apps/api/src/
  db/schema/bookings.ts     seq, the passenger index, the history pool index
  db/schema/pools.ts        seq, the vehicle index
  services/bookings.ts      listRideHistory
  services/history.ts       listDriverTrips, getPastTrip, getEarnings
  routes/v1/bookings.ts     GET /
  routes/v1/driver.ts       GET /pools, /pools/:id, /earnings
```

`services/pools.ts` stays about the trip in progress.

---

## 7. Seed and the story

No change to the seed. History fills up as the story is played. Here it is with phase 5 §7's fallback distances, Nusrat paying by TeslaPay and Rafiq in cash:

1. Nusrat and Rafiq pool with Jashim. He completes both. Final fares are ৳ 52.02 and ৳ 71.42.
2. **Nusrat's history** lists the ride with its breakdown: 0.000 → 1.835 km, shared 1.835, computed 52.02, estimate 66.70. There is nothing about Rafiq.
3. **Jashim's trips** list one trip: 2 passengers, 2 completed, earnings ৳ 123.44 (cash ৳ 71.42, TeslaPay ৳ 52.02). His earnings read the same.
4. Shirin requests, Jashim accepts, and she cancels after 3 minutes. Her history shows the cancelled ride with the ৳ 30.00 late-cancel fine. Jashim's second trip shows her as "Cancelled late", with no earnings.

---

## 8. Frontend

| Screen | Change |
|---|---|
| Header | A **History** link for both roles. It stays highlighted on the detail pages. |
| `/passenger/rides` | Past rides, newest first: date and time in Dhaka, pickup → destination, a status badge, and the final fare or the fine. **Load more** reads the next page. Each ride opens its detail page. |
| `/passenger/rides/[id]` | One ride: the route, the driver and Tesla, option, seats, payment, when it was requested and when it ended. Then the fare breakdown (phase 3's `FareBreakdown`) or the fine. |
| `/driver/trips` | An earnings card: the total, with cash and TeslaPay and the number of rides. Then past trips: date, passengers, and what the trip earned. **Load more**. |
| `/driver/trips/[id]` | One trip: each passenger with an outcome badge ("Completed", "Cancelled", "Cancelled late", "No-show", "You cancelled", plus "Penalty recorded"), their fare, and the breakdown in an expandable section. |

- Every screen has loading, empty ("No past rides yet", "No finished trips yet"), error and not-found states (NFR-22).
- Times are shown in Dhaka time and money as ৳ with two decimals, using the existing helpers.
- The paging state moves out of the wallet screen into a shared hook, and the route and fine lines out of the current-ride card, so the history screens reuse them.

---

## 9. Tests

All against a real Postgres. The real map service is never called (NFR-28).

| Area | Cases |
|---|---|
| Passenger history | A new passenger's list is empty. A completed ride, a free cancel and a late cancel are listed newest first; the ride in progress is not. The completed ride carries the stored breakdown, equal to its `fares` row. The late cancel carries the 30.00 fine. |
| Paging | `limit=1` visits every ride once, with `nextCursor` null at the end. A bad cursor and `limit=51` are 400. The same holds for the driver's trips. |
| Privacy | After the pooled story, Nusrat's history mentions neither Rafiq nor his fare. Another passenger's list is empty, and Nusrat's ride is 404 to them. A driver on `/bookings` is 403, and signed out is 401. |
| Driver trips | The pooled story is one trip with both passengers, 52.02 and 71.42, and the cash and TeslaPay split. The trip in progress isn't listed and is 404 by id. Another driver gets 404, and a passenger 403. |
| Outcomes | A drop shows `driver_cancelled` with `penaltyRecorded` false, or true after the 3 minutes. A no-show and a late cancel show their outcomes and earn nothing. |
| Earnings | A new driver reads `"0.00"` three times and 0 rides. After a cash ride and a TeslaPay ride, the split is right. The invariant in §4. |
