# Road routes on the map: Low-Level Design

**Branch:** `feature/route-paths`
**Covers:** FR-L1, FR-L2, FR-L3, FR-P3, FR-P8, FR-D8, FR-D14 · NFR-2, NFR-3, NFR-8, NFR-9, NFR-13, NFR-24, NFR-28, NFR-41, NFR-44

Added after phase 8. Pooling is the heart of the app, yet the map never showed a road. The driver saw a straight dashed line through the stops, a passenger choosing a trip saw two dots, and a passenger waiting for a ride saw no map at all. So the thing the matching rule checks (does this request lie along the driver's route?) couldn't be seen. This change draws the real road: the passenger's own trip, the driver's remaining route, and, when the driver previews a request, that request's trip over the route, so the overlap shows.

Route planning, the matching rule, fares, the booking state machine and every stored distance are unchanged. The road shape is for display only.

---

## 1. Scope

**In**

- Road shapes from OpenRouteService (ORS) directions, cached per leg in a new table.
- The passenger's own trip, pickup to destination: on the request form with the fare estimate, and on the ride card while waiting and riding.
- The driver's remaining route by road, from where the Tesla is through every stop still to come.
- The previewed request's own trip, drawn over the driver's route (the driver-map LLD's **See destination** becomes **See route**).
- A one-line legend under each map that names what is drawn.

**Out**

- A passenger seeing the trip's route, or anything of another passenger's (FR-P8, NFR-9). The pooled route passes through co-passengers' stops.
- Drawing the route a request *would* make if accepted. The preview shows the request's own trip, and the list already says how many km it adds.
- Using the shape for anything but drawing: distances still come from the distance cache and the matrix (NFR-41).
- Gliding the Tesla along the road. It still glides in a straight line (driver-map LLD §1).
- Live positions or a travelled track. There is no GPS (FR §12).

This supersedes the driver-map LLD's "Out: drawing the road itself".

---

## 2. Road shapes

### Asking ORS

`POST /v2/directions/driving-car` with every point of the path in order, in one request. The JSON answer carries `routes[0].geometry`, an encoded polyline (precision 5), and `routes[0].way_points`, the index in that polyline of each point asked for. The polyline is split at those indices into one leg per pair of points. The key goes in a header and the timeout is the same 10 s as for distances (NFR-13, NFR-43).

### Caching

`route_path_cache` keeps one row per leg, like `distance_cache`:

| Column | Type | Notes |
|---|---|---|
| id | uuid | |
| origin_lat, origin_lng, dest_lat, dest_lng | coordinate | Unique together. A→B is not B→A. |
| polyline | text | The leg's own encoded polyline. |
| created_at | timestamptz | |

- Only road shapes are cached. A straight fallback line is never stored, so the road appears once the map service answers again. This is the distance cache's rule.
- It is a separate table because `distance_cache` rows never change (NFR-41) and matrix rows have no shape, so adding a column would mean filling it in later.
- Nothing refers to it. Deleting every row only costs a few map requests.

### The path service

`legsThrough(points)` returns one leg per pair of consecutive points, in order:

1. A pair at one point (a pickup at the last drop-off) is a leg with no line.
2. Every cached leg among the pairs is read in one query.
3. If any is missing, one ORS request goes through all the points, skipping repeats. Its legs are stored (`ON CONFLICT DO NOTHING`, since two viewers may ask at once).
4. If ORS can't answer (no key, an error, out of quota, not routable, timed out, or a malformed answer), each missing leg becomes a straight line between its two points, marked `fallback`, and the fallback is logged as a warning (NFR-44).
5. ORS snaps each point to the nearest road, so a routed line can end a few metres from its stop. Each routed leg starts and ends at its exact points, so the line meets the dot.

There is no map budget. The shape is asked for only when what's drawn changes, never by the driver's 4 s request list (NFR-3). One new layout costs at most one map request, and the free directions quota (about 2000 a day) is far more than the demo needs.

---

## 3. API

A leg is sent as:

```json
{ "method": "routed", "points": [[23.7937, 90.4066], [23.7925, 90.4071]] }
```

`points` are `[lat, lng]` pairs with 5 decimals. `method` is `routed` or `fallback`.

| Method | Route | Who | Returns |
|---|---|---|---|
| POST | `/fare-estimates` | Passenger | The estimate as before, plus `path: { legs: [leg] }` from pickup to destination. |
| GET | `/bookings/:id/path` | Passenger | `{ legs: [leg] }` from the booking's pickup to its destination. |
| GET | `/driver/pool/path` | Driver | `{ legs }` from the Tesla through each stop still to come. Each leg has `toStopId`. No active trip → `{ legs: [] }`. |
| GET | `/driver/requests/:bookingId/path` | Driver | `{ legs: [leg] }` from the request's pickup to its destination. |

**Access (NFR-8, NFR-9)**

- `/bookings/:id/path`: the passenger's own booking, in any status. Someone else's, or none → 404. A driver → 403.
- `/driver/requests/:bookingId/path`: any booking still `REQUESTED`. Otherwise 404. A passenger → 403. This is a lighter check than the list itself uses. The path shows only a pickup and a destination, which a driver may see before accepting (NFR-9). Running the full list check again would mean running the matching rule and possibly the map service.
- A passenger never gets the pool's route. `/bookings/:id/path` is built from the booking's own two points, not from its stops.

**The estimate.** The path is looked up alongside the distance (`Promise.all`), so a new pair costs one directions request more, in parallel. A failed path never fails the estimate: it comes back as a straight fallback line.

**The driver's route** starts at the route's anchor, the point it goes on from (`progressOf` in `services/routes.ts`), and goes through every stop not yet reached. That anchor is the point the matching rule plans from and the web app puts the Tesla at (driver-map LLD §2), so the line starts under the Tesla. A pickup the driver is waiting at is where the Tesla stands, so no leg leads to it. Neither does a stop at the same place as the one before it: that leg has no line.

### Code

```
apps/api/
  drizzle/0014_create_route_path_cache.sql
  src/db/schema/routePathCache.ts     the table
  src/geo/polyline.ts                 decode, encode, split at way points (pure)
  src/geo/openRouteService.ts         + drivingPath
  src/geo/path.ts                     createPathService: §2
  src/services/paths.ts               the route paths of §3
  src/routes/v1/{bookings,driver,fareEstimates}.ts   the routes
```

---

## 4. Frontend

### The map

`MapPicker` takes `routes`, each a list of legs with a tone:

| Tone | Drawn as | Used for |
|---|---|---|
| `trip` | A dark line on a white casing. Fallback legs: thin, dashed, straight. | The passenger's own trip; the driver's route. |
| `preview` | Violet, thinner, above the trip line. Where the two share a road, it reads as a violet core inside the dark line. | The request the driver is previewing. |

- Routes lie under the stop dots and the Tesla, and above the nearby-Teslas layer.
- Each arrowhead into a stop is turned to the last stretch of road into it, not to a straight line.
- Until a route arrives, or if it fails, the map shows the dashed stop-order line as before.
- The map refits to include the road, since a road can bulge past the stops. It refits only when the route changes. Leaflet drops a view change asked for while a zoom animates, which is what happens when a road arrives just after the stops it joins. A refit that comes mid-zoom therefore waits for the zoom to end.

### Legend

One line under the map, naming only what is drawn:

- Your route · Request's trip, adds 0.97 km · Approximate (straight lines: map service unavailable)

It replaces the caption "the dashed line isn't the road".

### Screens

| Screen | Route |
|---|---|
| Passenger, request form | The trip, once the estimate is in. It clears with the estimate on any change. |
| Passenger, ride card | A small read-only map with the pickup, destination and own trip. Caption: "Your trip by road. A shared ride may detour up to 1 km." |
| Driver | The route through the stops still to come. It is read again when the stops or the Tesla's point change, not on every poll. |
| Driver, **See route** | That request's trip in violet over the route, with its pickup and destination dots. One at a time, cleared as before (driver-map LLD §4). |

---

## 5. Small deviations from the route

How the matching rule (FR-L3, `domain/matching.ts`) already treats requests a little off the route. Nothing here changes.

| Situation | Behaviour |
|---|---|
| Pickup a little off a leg | (a) Allowed if visiting it lengthens that leg by at most 1 km **by road**. A point that looks close can fail across a one-way street or a divider. |
| Destination a little off a later leg | (b) The same test on a later leg. Past the route's end the route may extend, if the newcomer's own ride is at most 1 km over their direct km, so it can't branch. |
| Several small detours | Each passenger's detour is measured against their own direct km, not the last plan, so small detours add up against one 1 km allowance. |
| A small detour with little shared distance | (d) Detour ≤ 0.4 × shared km. A 0.3 km detour needs 0.75 km shared. Otherwise the fare would pass the estimate. |
| Pickup behind the Tesla | Not on a leg still to come, so not listed, however close. |
| Map service down | Straight-line × 1.3. Straight-line detours are smaller than road ones, so more requests fit. The map then shows straight dashed lines, which says so. |
| Driver drives another way | Not modelled: a stop's reading is its planned km (FR-L5), so it never changes a fare. The drawn road is the plan, not a track. |

**On the map.** The preview is the request's own trip. For a pickup 300 m off the route, the violet line starts beside the dark one, and the loop the driver would drive isn't drawn. The legend gives the added km. Once accepted, the driver's route is read again and shows the detour through the new stops.

**Nusrat and Rafiq with real roads.** Checked with a real key while building this. Bullet waits at Banani Road 11 with Nusrat accepted (Banani → Mohakhali, 3.335 km by road). Rafiq's Banani → Gulshan 1 is 3.061 km direct, and Mohakhali → Gulshan 1 is 0.876 km, because the road passes Wireless Gate and turns back at a divider. Dropping Nusrat first gives Rafiq 3.335 + 0.876 = 4.211 km, a 1.15 km detour, over the 1 km allowance of (c). Dropping Rafiq first stretches Nusrat's ride by 1.7 km. So with a key, Rafiq isn't listed. The pair pools only with the straight-line fallback, where the detour is 0.518 km (README, Pooling). The map now shows why: Jashim's road runs west to Airport Road, south along it, and on past Wireless Gate before turning back at the divider. Moving a story pin (FR §13) would change the demo data, so it is left as a decision to make. A request whose drop-off lies on Jashim's road, for example on Airport Road, is listed at +0.001 km, and its trip draws on top of his route.

**Known gaps, left as they are:**

- The quick check before the matching rule keeps a request only if its pickup is within the search radius of the Tesla or a stop still to come, measured to those points, not to the legs between them. On a leg longer than about 4 km, a pickup near its middle can be left out before the rule runs. The demo's legs are 1–2 km. Measuring to each leg would fix it, as a matching change of its own.
- A request that fails the rule is simply not listed. The driver isn't told why.

---

## 6. Tests

| Area | Cases |
|---|---|
| Polyline | Decode a known polyline; encode and decode round-trip; split at way points. |
| Path service | Routed legs are cached, and a second call asks ORS nothing. ORS failing gives fallback straight legs, not cached. A repeated point gives a leg with no line. Legs meet their exact points. |
| Estimate | Carries a routed path. ORS failing for the path still gives the estimate, with a fallback path. |
| Driver route | Starts at the Tesla, follows the stop order, leaves out stops reached, has no leg into a pickup the driver is waiting at. No trip → no legs. |
| Access | Another passenger's booking → 404. A driver on `/bookings/:id/path` → 403. A passenger on driver routes → 403. A request no longer `REQUESTED` → 404. |

The fake ORS answers directions with a polyline straight through the points asked for (NFR-28). The map is checked by hand; the web app has no test runner.
