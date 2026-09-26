# Driver map — where the Tesla is: Low-Level Design

**Branch:** `feature/driver-map`
**Covers:** FR-D4, FR-R7, FR-C3, FR-C7 · NFR-22, NFR-24

Added after phase 8. On the driver's map, Bullet stayed where the trip began until the trip was over, often hidden under a pickup dot. The dashed line through the stops had no direction, and a drop-off was labelled with a place name only. This change shows the Tesla where the driver is, glides it there after each step, and adds an arrowhead to each stop. Route planning, fares and the booking state machine don't change.

---

## 1. Scope

**In**

- When a trip ends, the Tesla's saved location becomes where the trip ended.
- The driver's map shows the Tesla at the stop the driver has reached, and glides it there.
- An arrow at the end of each leg of the dashed stop-order line.
- Drop-offs named after their passenger, one label for stops at the same place, and stops already reached faded.

**Out**

- Drawing the road itself. The line still shows the stop order only.
- Gliding along roads. The Tesla glides in a straight line.

---

## 2. Where the Tesla is

The saved location (`vehicles.current_lat/lng`) is where the route is planned from while a trip is active (phase 5 LLD §3). It can't change mid-trip: the driver can't set it while carrying passengers, and nothing else writes it until the trip ends.

The map shows the Tesla at the same point the route goes on from (`routeProgress` in `domain/route.ts`):

1. The pickup of the next stop, if the driver has arrived there (`DRIVER_ARRIVED`).
2. Otherwise the last stop reached.
3. Otherwise the saved location, which is where the trip began.

The web app works this out from `GET /driver/pool`, which already carries the stops, their readings and each booking's status. No route is added.

---

## 3. When a trip ends

`finishPoolIfDone` ends the trip once none of its bookings is still with the driver (FR-R7). When it does, in the same transaction, it saves where the trip ended as the Tesla's location:

| How the trip ended | New location |
|---|---|
| The last drop-off (`complete`) | That drop-off: the last stop reached |
| A no-show | That passenger's pickup, where the driver waited |
| A driver or passenger cancel, after a stop was reached | The last stop reached |
| A cancel before any stop was reached | Unchanged |

- The last stop reached is the pool's reached stop with the highest `sequence`. The driver follows the stops in order, so that is the latest one.
- The write bumps the Tesla's `version`, as every write to it does (FR-C3). The Tesla is already locked by then: the driver's steps lock it first, and a passenger cancel locks the Tesla holding the booking (FR-C7).
- Nothing else changes. The driver can still set the location by hand when no trip is active (FR-D4). The app now also sets it at the end of a trip, so the next nearby requests are found from where the driver is.

A driver who arrived at a pickup and then cancels ends up at the last stop reached, not at that pickup. The pickup isn't a stop reached, and a cancel means the driver is leaving it.

---

## 4. Frontend

### `/driver` map

| Part | Change |
|---|---|
| Tesla | At the point from §2. Drawn above the stops, with its label below them. Glides from its old point to the new one in about 0.7 s. It doesn't glide on first load, and jumps straight there when the device asks for reduced motion. |
| Dashed line | Starts at the Tesla. An arrowhead points into each stop, just outside its dot. |
| Stops | `Pickup: Rafiq` and `Drop-off: Rafiq`. Stops of one kind at one place share a dot and a label, e.g. `Pickup: Rafiq & Nusrat`, so neither hides the other. A stop already reached is faded, and its label shows on hover; a shared one fades once all of its stops are reached. |
| Your location | Says where the Tesla is, e.g. "At Rafiq's pickup · Banani Road 11". |
| Caption | "The dashed line shows the order of your stops, with arrows, not the road." |

Saving a new location while idle glides the Tesla the same way.

### Arrows

Each arrowhead is a small SVG marker on the stop. It is rotated to the leg's angle on screen, and its tip sits a fixed number of pixels from the stop's centre, so it stays the same at any zoom. The angle comes from Leaflet's own projection. A leg of zero length has no arrow.

---

## 5. Tests

The API tests read `GET /driver/vehicle` after each step:

- A single ride: the location is unchanged after arrive and start, and is the destination after complete.
- A pooled ride: unchanged after the first drop-off, and the last drop-off after the second.
- A no-show that ends the trip: the pickup.
- A cancel before any stop is reached: unchanged.

The map is checked by hand. The web app has no test runner.
