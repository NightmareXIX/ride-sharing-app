// Encoded polylines, the format the map service sends road shapes in: each coordinate
// times 10^5, as a delta from the one before, in base-64 chunks of 5 bits. Pure, so it is
// easy to test (NFR-26).

// A point on a drawn road, [lat, lng], to 5 decimal places (about 1 m).
export type PathPoint = [number, number];

const PRECISION = 1e5;

function round5(value: number): number {
  return Math.round(value * PRECISION) / PRECISION;
}

// The points of an encoded polyline. Throws on a truncated string.
export function decodePolyline(encoded: string): PathPoint[] {
  const points: PathPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  const next = (): number => {
    let result = 0;
    let shift = 0;
    let chunk: number;
    do {
      if (index >= encoded.length) throw new Error('Truncated polyline');
      chunk = encoded.charCodeAt(index++) - 63;
      result |= (chunk & 0x1f) << shift;
      shift += 5;
    } while (chunk >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    lat += next();
    lng += next();
    points.push([lat / PRECISION, lng / PRECISION]);
  }
  return points;
}

function encodeValue(value: number): string {
  let rest = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (rest >= 0x20) {
    out += String.fromCharCode((0x20 | (rest & 0x1f)) + 63);
    rest >>= 5;
  }
  return out + String.fromCharCode(rest + 63);
}

export function encodePolyline(points: readonly PathPoint[]): string {
  let lat = 0;
  let lng = 0;
  let out = '';
  for (const [pointLat, pointLng] of points) {
    const nextLat = Math.round(pointLat * PRECISION);
    const nextLng = Math.round(pointLng * PRECISION);
    out += encodeValue(nextLat - lat) + encodeValue(nextLng - lng);
    lat = nextLat;
    lng = nextLng;
  }
  return out;
}

// One road through several points, cut into a leg per pair of them. `wayPoints[i]` is the
// index in `points` of the i-th point asked for. Null when the indices don't fit the road.
export function splitLegs(
  points: readonly PathPoint[],
  wayPoints: readonly number[],
): PathPoint[][] | null {
  if (wayPoints.length < 2 || wayPoints[0] !== 0 || wayPoints.at(-1) !== points.length - 1) {
    return null;
  }
  const legs: PathPoint[][] = [];
  for (let i = 1; i < wayPoints.length; i += 1) {
    const from = wayPoints[i - 1]!;
    const to = wayPoints[i]!;
    if (!Number.isInteger(to) || to < from) return null;
    legs.push(points.slice(from, to + 1));
  }
  return legs;
}

// A leg that starts and ends at its own two points. The map service snaps each point to
// the nearest road, so its line can stop a few metres short of the stop's dot.
export function pinEnds(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  road: readonly PathPoint[],
): PathPoint[] {
  const start: PathPoint = [round5(from.lat), round5(from.lng)];
  const end: PathPoint = [round5(to.lat), round5(to.lng)];
  const same = (a: PathPoint | undefined, b: PathPoint) => a?.[0] === b[0] && a?.[1] === b[1];
  const line = road.map(([lat, lng]): PathPoint => [round5(lat), round5(lng)]);
  if (!same(line[0], start)) line.unshift(start);
  if (!same(line.at(-1), end)) line.push(end);
  return line;
}
