# Phase 7 — Ride options: Low-Level Design

**Branch:** `feature/ride-options`
**Covers:** FR-R10, FR-D6, FR-D7, FR-L3(f), FR-F2, FR-P3, FR-P8, FR-S3, FR-C3, FR-C5 · NFR-3, NFR-9, NFR-19, NFR-22, NFR-26, NFR-27, NFR-28, NFR-37, NFR-44

This phase decides who may share a Tesla. A Solo passenger has the Tesla to themselves: nobody else joins while they ride. A Same-gender passenger shares only with passengers of their own gender, and anyone who joins later must match. Both options have been priced since phase 2. This phase makes them mean something.

---

## 1. Scope

**In**

- The ride-option rule, FR-L3(f) and FR-R10, as a pure module.
- The driver's request list applies it. An idle Tesla sees every option (FR-D6). A Tesla on a solo ride sees nothing, and a Tesla with passengers sees only requests the rule lets in (FR-D7).
- An accept applies it, and refuses a request that breaks it.
- The driver's trip says who can still join.
- The passenger's screens say what each option does.

**Already in place**

| What | Since |
|---|---|
| `users.gender`, required at sign-up (FR-P1) | Phase 1 |
| `bookings.ride_option` and the option multipliers 1.00, 1.05, 1.15 in the estimate and the final fare (FR-F2) | Phases 2 and 3 |
| The seed's genders: Nusrat and Shirin female, Rafiq and Jashim male | Phase 0 |

**Left for later phases**

| What | Phase |
|---|---|
| Ride history showing the option of each past ride | 8 |

---

## 2. Tables

None. The rule reads data that already exists: each booking's `ride_option` and its passenger's `gender`.

The rule doesn't need a database constraint of its own. A trip's riders change only through an accept, a cancel, a no-show or a complete, and each bumps the Tesla's `version`. An accept checks the rule on its snapshot and commits only at the version it saw (FR-C3). A change of riders in between refuses it. §4 has the detail.

---

## 3. Routes

### Who is in the Tesla

A trip's **riders** are its bookings that are `ACCEPTED`, `DRIVER_ARRIVED` or `STARTED`. For each one, the rule needs the ride option and the passenger's gender. A passenger who has been dropped off, cancelled or marked a no-show no longer counts.

FR-R10 says "while it is active" and "any passenger joining later". We read that as the whole trip, not only the km two passengers are aboard together. For example, a man can't join a trip while a Same-gender woman's booking is active, even if his pickup comes after her drop-off. Once she is dropped off, he can join. This is recorded in the README as an assumption.

### `GET /driver/requests`

| Driver's situation | Requests shown |
|---|---|
| Offline, or the Tesla is full | None |
| On a solo ride | **None** (FR-D7) |
| Online and idle | As before: every option, Solo included, near the Tesla (FR-D6) |
| Online with passengers | As before, but only requests the rule lets in |

For a Tesla with passengers, the rule is a quick check that needs no map (NFR §2). It runs **before** the radius check and the route check, so a request it rules out never uses up one of the 3 route checks per refresh (NFR-3).

The passenger's gender is read for the check and never sent to the driver. `NearbyRequest` doesn't change (NFR-9).

### `POST /driver/requests/:bookingId/accept`

The phase 5 snapshot → checks → plan → commit, with one more check. The snapshot also reads the request's ride option and passenger gender, and the trip's riders. The rule runs after the seat check and before any map request.

| Case | Response |
|---|---|
| The Tesla is on a solo ride | `422 NO_LONGER_MATCHES` "Your Tesla is on a solo ride." |
| A Solo request, and the Tesla has passengers | `422 NO_LONGER_MATCHES` "Solo rides need an empty Tesla." |
| A gender mismatch with a Same-gender booking on either side | `422 NO_LONGER_MATCHES` "This request can't share with the passengers in your Tesla." |

Nothing changes on a refusal. The reason (`TESLA_ON_SOLO_RIDE`, `SOLO_NEEDS_EMPTY_TESLA` or `GENDER_MISMATCH`) is logged, as the matching reasons are. A repeat accept by the same driver still returns 200 first (FR-C5, NFR-37).

When the commit finds the Tesla's version moved, it judges again from the rows as they are now (phase 4). That judgement now includes the riders. So if a Pool accept beats a Solo accept to an idle Tesla, the Solo accept hears "Solo rides need an empty Tesla." rather than `POOL_CHANGED`.

### `GET /driver/pool`

The trip gains `joinRule`, which says who the rule still lets in:

| `joinRule` | When |
|---|---|
| `no_one` | A rider is Solo |
| `women` / `men` | A rider is Same-gender. Every rider has that gender. |
| `anyone` | Otherwise. A Same-gender request still joins only if every rider matches it. |

```json
{ "pool": { "id": "…", "joinRule": "women", "seats": { "capacity": 3, "taken": 2 }, "…": "as before" } }
```

The driver already sees each passenger's name and ride option (FR-D14). The rule adds nothing about any single passenger.

### The passenger's booking

No change. A passenger never learns who else is in the Tesla, or their gender (FR-P8, NFR-9).

### Error codes added in this phase

None. `NO_LONGER_MATCHES` now also means "the ride options don't allow it". Every 4xx is logged as a warning (NFR-44).

---

## 4. Rules

### The ride-option rule (NFR-26)

`domain/rideOptions.ts` is pure. A rider and a candidate are each `{ rideOption, gender }`.

`canJoin(riders, candidate)` checks, in this order:

| # | Check | Reason |
|---|---|---|
| 1 | No riders: an idle Tesla takes any option | `ok` |
| 2 | A rider is Solo | `TESLA_ON_SOLO_RIDE` |
| 3 | The candidate is Solo | `SOLO_NEEDS_EMPTY_TESLA` |
| 4 | The candidate or any rider is Same-gender, and some rider's gender differs from the candidate's | `GENDER_MISMATCH` |
| 5 | Otherwise | `ok` |

The driver's gender is never an input (FR-R10). Seats are still the seat claim's job, and the route is the matching rule's.

`joinRule(riders)` summarises the same rule for the driver's screen, as in §3.

### Where each guarantee lives

| Guarantee | Enforced by |
|---|---|
| Nobody joins a solo ride | `canJoin` in the list and the accept, then the version check at commit |
| A Solo request goes only to an empty Tesla (FR-D6) | `canJoin` rule 3, then the version check |
| A Same-gender trip holds one gender | `canJoin` rule 4, then the version check |
| A race can't slip past the rule (FR-C3) | The seat update's `version = $seenVersion`. Accept, cancel, no-show and complete all bump the version. |
| The driver never learns a requester's gender (NFR-9) | The gender is read for the filter and left out of `NearbyRequest` |

**The invariant**, checked after every race in the tests: no active pool holds a Solo booking alongside another assigned booking, and no active pool with an assigned Same-gender booking holds two genders among its assigned bookings. Phase 4 and 5's seat and route invariants still hold.

---

## 5. Configuration

None added.

---

## 6. Code layout (NFR-26)

```
apps/api/src/
  domain/rideOptions.ts         pure: canJoin, joinRule
  domain/matching.ts            comment: (f) lives in rideOptions.ts
  services/pools.ts             tripRiders; the accept's snapshot reads riders and the
                                candidate's option and gender; judgeAccept applies canJoin;
                                the trip gains joinRule
  services/requests.ts          a solo Tesla sees nothing; a busy Tesla's candidates pass
                                canJoin before the radius and route checks
```

---

## 7. Seed and the story

No change to the seed: the genders and balances already allow both demos (FR-S3). The distances are phase 5 §7's fallback distances, with no map key.

**A same-gender pool.**

1. Jashim goes online at Banani Road 11.
2. Nusrat requests Banani Road 11 → Mohakhali, 1 seat, **Same-gender**, TeslaPay. Estimate `(30 + 20 × 1.835) × 1.05 = 70.035`, so ৳ 70.04. Jashim accepts. His trip shows "Women only".
3. Shirin requests the same trip, Same-gender, Cash. It is listed, and Jashim accepts.
4. Rafiq requests Banani Road 11 → Gulshan 1, Pool. Jashim's list doesn't show it. An accept by id gets 422.
5. Jashim completes both. Each shared all 1.835 km:

| | Nusrat | Shirin |
|---|---|---|
| Actual km, shared km | 1.835, 1.835 | 1.835, 1.835 |
| Computed | `(30 + 36.70 − 14.68) × 1.05 = 54.621` | the same |
| Estimate | 70.04 | 70.04 |
| **Final** | **৳ 54.62**, TeslaPay | **৳ 54.62**, Cash |

**A solo ride.**

1. Rafiq requests Banani Road 11 → Gulshan 1, **Solo**. Estimate `(30 + 20 × 2.287) × 1.15 = 87.101`, so ৳ 87.10. Jashim, idle, sees it and accepts.
2. Jashim's list is empty, with "You're on a solo ride". Nusrat's request is refused if accepted by id.
3. Rafiq rides alone, so actual km = direct km and no km are shared. Final **৳ 87.10**.

---

## 8. Frontend

| Screen | Change |
|---|---|
| `/passenger`, request form | Each option says what it does. Pool: "Share the ride". Same-gender: "Only women, +5%" or "Only men, +5%", from the signed-in passenger's gender. Solo: "Just you, +15%". |
| `/passenger`, waiting | A Solo request says "Solo: waiting for a driver with an empty Tesla." A Same-gender one says "Same-gender: you'll share only with women." (or men) |
| `/driver`, trip | A badge by the seats: "Solo ride", "Women only" or "Men only". Nothing for `anyone`. |
| `/driver`, requests on a trip | On a solo ride: "You're on a solo ride. New requests appear after the drop-off." On a Same-gender trip, above the list: "Same-gender trip: only women can join." (or men) |

- `NO_LONGER_MATCHES` already shows the server's message and refreshes the list (NFR-22).
- A passenger never sees anything about co-passengers (FR-P8).

---

## 9. Tests

All against a real Postgres. The real map service is never called (NFR-28). Race tests run **25 rounds**, as in phase 4.

| Area | Cases |
|---|---|
| Rule (unit) | Every row of §4: an idle Tesla with each option; a Solo rider refuses every option; a Solo candidate is refused by any rider; a Same-gender candidate with a matching trip, a mixed trip and a trip of the other gender; a Pool candidate with a Same-gender trip of each gender; a Pool candidate with a Pool trip of the other gender (allowed). `joinRule` for each. |
| Request list | An idle Tesla lists Solo and Same-gender requests. A Tesla with a Pool rider doesn't list a Solo request. A Tesla on a solo ride lists nothing. A Same-gender trip of women lists Shirin's request and not Rafiq's. A Pool trip with Rafiq doesn't list Nusrat's Same-gender request but lists Shirin's Pool one. No item carries a gender. |
| Map budget | With the counting map stub, requests the rule refuses make no map request, so the 3 checks go to requests that can join |
| Accept | Each refusal in §3 → 422 `NO_LONGER_MATCHES`, with the seats, the booking, the route and the version unchanged. A repeat accept → 200. |
| Trip body | `joinRule` is `no_one`, `women`, `men` and `anyone` in the matching situations, and back to `anyone` once the Same-gender riders are dropped off |
| The story | §7 exactly: 70.04, 54.62 and 54.62 for the same-gender pool, Rafiq refused while it runs and listed after it; 87.10 for Rafiq's solo ride, with nothing listed during it |
| Races (×25) | An idle Tesla: a Solo accept and a Pool accept at once → exactly one wins, and the loser changes nothing. A women-only trip: Shirin's and Rafiq's accepts at once → Rafiq never joins. After each: the invariant in §4, and phase 4 and 5's. |
