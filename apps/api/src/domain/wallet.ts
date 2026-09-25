import Big from 'big.js';

// TeslaPay rules from FR §2 and §9, kept free of I/O so they are easy to test (NFR-26).
// Amounts are exact decimals (big.js) and travel as strings such as "30.00".

// Every kind of money movement the ledger records (FR-W8).
export const WALLET_TRANSACTION_TYPES = [
  'top_up',
  'fare_payment',
  'driver_credit',
  'cash_earning',
  'fine',
] as const;
export type WalletTransactionType = (typeof WALLET_TRANSACTION_TYPES)[number];

// Money out of the wallet; every other movement is money in.
const OUTGOING: readonly WalletTransactionType[] = ['fare_payment', 'fine'];

// A late cancel or a no-show costs the passenger 30 tk (FR-P7, FR-D11).
export const FINE_AMOUNT = '30.00';

// Pretend money, within limits that keep numeric(10,2) far from overflowing (FR-W2).
export const MIN_TOP_UP = '1.00';
export const MAX_TOP_UP = '10000.00';
export const MAX_BALANCE = '100000.00';

// Up to five whole taka and at most two decimals, e.g. "500" or "500.00".
const TOP_UP_PATTERN = /^\d{1,5}(\.\d{1,2})?$/;

// A cash fare is paid in person, so it is recorded as earnings but leaves the wallet as it
// is (FR-W5). Every other movement changes the balance.
export function affectsBalance(type: WalletTransactionType): boolean {
  return type !== 'cash_earning';
}

// The amount as the ledger stores it: negative for money out, positive for money in.
export function signedAmount(type: WalletTransactionType, amount: string): string {
  const size = new Big(amount).abs();
  return (OUTGOING.includes(type) ? size.neg() : size).toFixed(2);
}

// Why a top-up amount is refused, or null if it is fine.
export function topUpProblem(amount: string): string | null {
  if (!TOP_UP_PATTERN.test(amount)) return 'must be an amount in taka with at most 2 decimals';
  const value = new Big(amount);
  if (value.lt(MIN_TOP_UP)) return `must be at least ${MIN_TOP_UP}`;
  if (value.gt(MAX_TOP_UP)) return `must be at most ${MAX_TOP_UP}`;
  return null;
}
