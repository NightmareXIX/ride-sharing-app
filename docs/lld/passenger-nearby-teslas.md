# Nearby Teslas for passengers: Low-Level Design

**Branch:** `feature/nearby-teslas`
**Covers:** FR-P3, FR-D6, FR-D8, FR-R10 · NFR-1, NFR-3, NFR-8, NFR-9, NFR-10, NFR-24, NFR-26, NFR-27

Added after phase 8. A passenger choosing a pickup can't tell whether any Tesla is around. The request map now shows the Teslas within 2 km of the pickup, with a count. It is for looking only. The passenger still can't choose a driver: drivers choose requests, and nothing is assigned (FR-D8).

---

## 1. Scope

**In**

- `GET /nearby-teslas`: the Teslas that could take a passenger now, near a point.
- Each Tesla at its latest checkpoint, not at where its trip began.
- On the passenger's "Where to?" map: the Teslas as small dots, the 2 km circle, and a count.

**Out**

- Choosing, or even tapping, a Tesla.
- Who the Teslas are: no driver, name, seats or id.
- Nearby Teslas while waiting for a driver. The waiting card has no map.
- Live positions. There is no GPS (FR-D4), and the map refreshes every 4 s like every other screen (NFR-3).

---

## 2. Which Teslas, and where

A Tesla is listed when it is online, has a free seat (`occupied_seats < capacity`), and its point is within the search radius of the pickup. A Tesla on a solo ride is left out. It has free seats but takes no one (`joinRule = 'no_one'`, FR-R10), so it is no nearer to taking this passenger than a full one.

A Tesla on a same-gender trip is listed for everyone. Leaving it out for a man would tell him the riders in that Tesla are women, which is a detail about other passengers (NFR-9).

**Its point.** While a Tesla has a trip, its saved location stays where the trip began, because the route is planned from it (driver-map LLD §2). Where the driver really is comes from the route's anchor (`routeProgress` in `domain/route.ts`):

1. the pickup the driver is waiting at (`DRIVER_ARRIVED`);
2. otherwise the last stop reached;
3. otherwise the saved location.

The driver's map and the matching rule use the same anchor, so all three agree. A Tesla with no trip is at its saved location.

**Nearness** is a straight line (`isNearby`), with the radius a driver searches for requests in (`DRIVER_SEARCH_RADIUS_KM`, default 2 km, FR-D6). So an idle Tesla listed here would also see a request made from this pickup. Nothing waits on the map service (NFR-1).

### How it is read

Two queries, however many Teslas there are:

| Step | What |
|---|---|
| 1 | The online Teslas with a free seat, each with its saved location and its active trip, if any. |
| 2 | Only if some have a trip: the stops of those trips in order, each with its booking's status, ride option and passenger's gender. |
| 3 | In memory, for each Tesla: its riders (bookings accepted, waited for or aboard), its join rule, and its anchor. |
| 4 | Keep those within the radius. |

Step 1 can't narrow by a box around the saved location, since a Tesla on a trip may have moved far from it. It reads one row per online driver with a free seat, which is fine at this size. At scale, each checkpoint would go into a geo index (Redis GEO or PostGIS), as the NFRs list for later.

The anchor is worked out when asked for, not stored. Storing it would mean a new column written by arrive, complete and no-show inside their locked transactions (FR-C7), for a feature that only shows things.

---

## 3. Privacy

- Each point is rounded to 3 decimal places, about 110 m. It is rounded after the radius check, so the check uses the exact point.
- Only `{ lat, lng }` is sent: no id, driver, Tesla name, seats or trip.
- The list is sorted by coordinates, so its order doesn't follow any driver.
- A passenger can see cars near them, but can't follow one driver or learn who it is.

---

## 4. API

| Method | Route | Who |
|---|---|---|
| GET | `/nearby-teslas?lat=23.7937&lng=90.4066` | Passengers. A driver → 403, signed out → 401 (NFR-8). |

`lat` and `lng` are numbers inside Dhaka, the same rules as a pickup. Missing, not a number or outside Dhaka → `400 VALIDATION_ERROR` with `details` (NFR-10).

```json
{ "radiusKm": 2, "teslas": [{ "lat": 23.794, "lng": 90.405 }] }
```

It reads saved data only, so it is quick enough to poll every 4 s (NFR-1, NFR-3).

### Code

```
apps/api/src/
  domain/dispatch.ts            + blurPoint: rounded to 3 dp
  services/nearbyTeslas.ts      listNearbyTeslas: §2
  routes/v1/nearbyTeslas.ts     GET /nearby-teslas
  routes/v1/schemas.ts          + nearbyQuery
```

---

## 5. Frontend

On `/passenger`, in the request form:

| Part | Behaviour |
|---|---|
| Teslas | Small dark dots at the listed points, below the pickup and destination. They can't be tapped: a tap there sets the stop, as anywhere else on the map. |
| Circle | A faint dashed circle of the radius around the pickup. |
| Count | Under the map, read out when it changes: "Set a pickup to see Teslas near it.", "2 Teslas within 2 km of your pickup. A nearby driver accepts your request; you can't choose one.", or "No Teslas within 2 km right now. You can still request a ride." |
| Refresh | Read at once when a pickup is set or changed, then every 4 s. A reply for an earlier pickup is dropped. A failure keeps the last result, with no error: the form works without it. |
| Map | Doesn't refit to the Teslas, so it doesn't jump on every refresh. |

---

## 6. Tests

API tests (`test/nearbyTeslas.test.ts`):

| Area | Cases |
|---|---|
| Listed | An idle online Tesla near the pickup, rounded to 3 dp, with only `lat` and `lng`. |
| Not listed | Offline. Beyond the radius. Full. On a solo ride. |
| Checkpoint | Accepted: at its saved location. Arrived: at the pickup. After a pooled trip's first drop-off: there, even when that is beyond the radius from where the trip began. |
| Options | On a same-gender trip of women: listed to a man. |
| Access | A driver → 403. Signed out → 401. `lat` missing, or outside Dhaka → 400. |

A unit test covers `blurPoint`. The map is checked by hand; the web app has no test runner.
