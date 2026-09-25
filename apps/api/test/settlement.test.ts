import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool } from '../src/db/client.js';
import { driverSignUp, passengerSignUp, resetDb, signUpAs } from './support/accounts.js';
import { TEST_DATABASE_URL } from './support/db.js';
import {
  BANANI,
  GULSHAN_1,
  acceptRequest,
  driverAction,
  goOnlineAt,
  requestRide,
  tripFrom,
  type BookingBody,
} from './support/rides.js';
import { startTestServer, type TestServer } from './support/server.js';
import {
  allTransactions,
  balanceOf,
  entriesFor,
  expectLedgerConsistent,
  topUp,
} from './support/wallet.js';

let pool: pg.Pool;
let server: TestServer;
let jashim: string;
let nusrat: string;
let rafiq: string;

beforeAll(async () => {
  pool = createPool(TEST_DATABASE_URL);
  server = await startTestServer(pool);
});

afterAll(async () => {
  await server.close();
  await pool.end();
});

beforeEach(async () => {
  await resetDb(pool);
  jashim = await signUpAs(server, driverSignUp());
  nusrat = await signUpAs(server, passengerSignUp());
  rafiq = await signUpAs(
    server,
    passengerSignUp({ name: 'Rafiq', email: 'rafiq@example.com', gender: 'male' }),
  );
  await goOnlineAt(server, jashim, BANANI);
});

async function step(booking: BookingBody, action: 'arrive' | 'start' | 'complete') {
  const res = await driverAction(server, jashim, booking.id, action);
  if (res.status !== 200) throw new Error(`${action}: ${res.status} ${await res.text()}`);
  return res;
}

// One passenger's ride from request to drop-off; returns the booking and its final fare.
async function rideAlone(passenger: string, paymentMethod: 'cash' | 'teslapay') {
  const booking = await requestRide(server, passenger, tripFrom(BANANI, { paymentMethod }));
  expect((await acceptRequest(server, jashim, booking.id)).status).toBe(200);
  await step(booking, 'arrive');
  await step(booking, 'start');
  const res = await step(booking, 'complete');
  const { fare } = (await res.json()) as { fare: { finalFare: string } };
  return { booking, finalFare: fare.finalFare };
}

describe('completing a TeslaPay ride (FR-W4)', () => {
  it("moves the final fare from the passenger's wallet to the driver's", async () => {
    await topUp(server, nusrat, '100.00');
    const { booking, finalFare } = await rideAlone(nusrat, 'teslapay');
    expect(finalFare).toBe('66.70');

    expect(await balanceOf(server, nusrat)).toBe('33.30');
    expect(await balanceOf(server, jashim)).toBe('66.70');
    expect(await entriesFor(pool, booking.id)).toEqual([
      { type: 'fare_payment', amount: '-66.70', email: 'nusrat@example.com' },
      { type: 'driver_credit', amount: '66.70', email: 'jashim@example.com' },
    ]);

    const [payment] = await allTransactions(server, nusrat);
    expect(payment).toMatchObject({
      type: 'fare_payment',
      amount: '-66.70',
      balanceAfter: '33.30',
      bookingId: booking.id,
    });
    await expectLedgerConsistent(pool);
  });

  it('pays once when the driver taps Complete twice (NFR-37)', async () => {
    await topUp(server, nusrat, '100.00');
    const { booking } = await rideAlone(nusrat, 'teslapay');
    expect((await driverAction(server, jashim, booking.id, 'complete')).status).toBe(200);

    expect(await balanceOf(server, nusrat)).toBe('33.30');
    expect(await entriesFor(pool, booking.id)).toHaveLength(2);
  });
});

describe('completing a Cash ride (FR-W5)', () => {
  it("records the driver's earnings and leaves both balances alone", async () => {
    const { booking } = await rideAlone(nusrat, 'cash');

    expect(await balanceOf(server, nusrat)).toBe('0.00');
    expect(await balanceOf(server, jashim)).toBe('0.00');
    expect(await entriesFor(pool, booking.id)).toEqual([
      { type: 'cash_earning', amount: '66.70', email: 'jashim@example.com' },
    ]);
    const [earning] = await allTransactions(server, jashim);
    expect(earning).toMatchObject({ type: 'cash_earning', balanceAfter: '0.00' });
    expect(await allTransactions(server, nusrat)).toEqual([]);
    await expectLedgerConsistent(pool);
  });
});

describe("Nusrat and Rafiq's shared trip, paid by TeslaPay (phase 6 LLD §7)", () => {
  it('charges each their pooled fare and credits Jashim both', async () => {
    await topUp(server, nusrat, '500.00');
    await topUp(server, rafiq, '500.00');
    const nusrats = await requestRide(
      server,
      nusrat,
      tripFrom(BANANI, { paymentMethod: 'teslapay' }),
    );
    expect((await acceptRequest(server, jashim, nusrats.id)).status).toBe(200);
    const rafiqs = await requestRide(
      server,
      rafiq,
      tripFrom(BANANI, { destination: GULSHAN_1, paymentMethod: 'teslapay' }),
    );
    expect((await acceptRequest(server, jashim, rafiqs.id)).status).toBe(200);

    await step(nusrats, 'arrive');
    await step(nusrats, 'start');
    await step(rafiqs, 'arrive');
    await step(rafiqs, 'start');
    await step(nusrats, 'complete');
    await step(rafiqs, 'complete');

    expect(await balanceOf(server, nusrat)).toBe('447.98');
    expect(await balanceOf(server, rafiq)).toBe('428.58');
    expect(await balanceOf(server, jashim)).toBe('123.44');
    expect((await allTransactions(server, jashim)).map((entry) => entry.amount)).toEqual([
      '71.42',
      '52.02',
    ]);
    await expectLedgerConsistent(pool);
  });
});
