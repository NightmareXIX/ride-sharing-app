import { describe, expect, it } from 'vitest';
import { decodePolyline, encodePolyline, pinEnds, splitLegs } from '../src/geo/polyline.js';

// The format's own worked example.
const EXAMPLE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
const EXAMPLE_POINTS: [number, number][] = [
  [38.5, -120.2],
  [40.7, -120.95],
  [43.252, -126.453],
];

describe('encoded polylines (route-paths LLD §2)', () => {
  it('decodes the worked example', () => {
    expect(decodePolyline(EXAMPLE)).toEqual(EXAMPLE_POINTS);
  });

  it('encodes it back', () => {
    expect(encodePolyline(EXAMPLE_POINTS)).toBe(EXAMPLE);
  });

  it('round-trips Dhaka points to 5 decimal places', () => {
    const road: [number, number][] = [
      [23.7937, 90.4066],
      [23.78712, 90.40781],
      [23.7812, 90.409],
    ];
    expect(decodePolyline(encodePolyline(road))).toEqual(road);
  });

  it('refuses a truncated string', () => {
    expect(() => decodePolyline(EXAMPLE.slice(0, -1))).toThrow();
  });
});

describe('splitting a road into legs', () => {
  const road: [number, number][] = [
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
  ];

  it('cuts at each point asked for, sharing the point between legs', () => {
    expect(splitLegs(road, [0, 2, 4])).toEqual([
      [
        [0, 0],
        [0, 1],
        [0, 2],
      ],
      [
        [0, 2],
        [0, 3],
        [0, 4],
      ],
    ]);
  });

  it('refuses indices that do not span the road or go backwards', () => {
    expect(splitLegs(road, [0, 3])).toBeNull();
    expect(splitLegs(road, [1, 4])).toBeNull();
    expect(splitLegs(road, [0, 3, 2, 4])).toBeNull();
    expect(splitLegs(road, [0])).toBeNull();
  });
});

describe('pinning a leg to its stops', () => {
  const from = { lat: 23.7937, lng: 90.4066 };
  const to = { lat: 23.7812, lng: 90.409 };

  it('adds the stops where the road was snapped away from them', () => {
    const snapped: [number, number][] = [
      [23.79365, 90.40672],
      [23.78125, 90.40893],
    ];
    expect(pinEnds(from, to, snapped)).toEqual([[23.7937, 90.4066], ...snapped, [23.7812, 90.409]]);
  });

  it('adds nothing where the road already meets them', () => {
    const road: [number, number][] = [
      [23.7937, 90.4066],
      [23.7812, 90.409],
    ];
    expect(pinEnds(from, to, road)).toEqual(road);
  });

  it('gives a straight line for no road', () => {
    expect(pinEnds(from, to, [])).toEqual([
      [23.7937, 90.4066],
      [23.7812, 90.409],
    ]);
  });
});
