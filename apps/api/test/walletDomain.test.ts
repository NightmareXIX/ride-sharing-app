import { describe, expect, it } from 'vitest';
import {
  affectsBalance,
  signedAmount,
  topUpProblem,
  WALLET_TRANSACTION_TYPES,
} from '../src/domain/wallet.js';

describe('signedAmount (FR-W8)', () => {
  it.each([
    ['top_up', '500.00', '500.00'],
    ['driver_credit', '52.02', '52.02'],
    ['cash_earning', '71.42', '71.42'],
    ['fare_payment', '52.02', '-52.02'],
    ['fine', '30.00', '-30.00'],
  ] as const)('gives a %s of %s the sign %s', (type, amount, signed) => {
    expect(signedAmount(type, amount)).toBe(signed);
  });

  it('keeps the sign right whichever sign the amount arrives with', () => {
    expect(signedAmount('fine', '-30')).toBe('-30.00');
    expect(signedAmount('top_up', '-5.5')).toBe('5.50');
  });
});

describe('affectsBalance (FR-W5)', () => {
  it('leaves the balance alone for cash earnings only', () => {
    const moving = WALLET_TRANSACTION_TYPES.filter((type) => affectsBalance(type));
    expect(moving).toEqual(['top_up', 'fare_payment', 'driver_credit', 'fine']);
  });
});

describe('topUpProblem (FR-W2)', () => {
  it.each(['1.00', '1', '10000', '10000.00', '12.5', '999.99'])('accepts %s', (amount) => {
    expect(topUpProblem(amount)).toBeNull();
  });

  it.each([
    ['0.99', 'must be at least 1.00'],
    ['10000.01', 'must be at most 10000.00'],
    ['5.001', 'must be an amount in taka with at most 2 decimals'],
    ['-5', 'must be an amount in taka with at most 2 decimals'],
    ['1e3', 'must be an amount in taka with at most 2 decimals'],
    ['', 'must be an amount in taka with at most 2 decimals'],
    ['100000', 'must be an amount in taka with at most 2 decimals'],
  ])('refuses %j', (amount, problem) => {
    expect(topUpProblem(amount)).toBe(problem);
  });
});
