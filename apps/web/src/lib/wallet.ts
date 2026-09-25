// The body of GET /wallet. Money arrives as a string such as "447.98", never a number.
export interface Wallet {
  balance: string;
  updatedAt: string;
}

export type TransactionType = 'top_up' | 'fare_payment' | 'driver_credit' | 'cash_earning' | 'fine';

// One money movement, as GET /wallet/transactions lists it.
export interface WalletTransaction {
  id: string;
  type: TransactionType;
  // Signed: "-30.00" is money out.
  amount: string;
  balanceAfter: string;
  bookingId: string | null;
  // Why a fine was charged; null for every other movement.
  reason: 'late_cancel' | 'no_show' | null;
  createdAt: string;
}

export interface TransactionPage {
  transactions: WalletTransaction[];
  nextCursor: string | null;
}

// The body of POST /wallet/top-ups.
export interface TopUpResult {
  transaction: WalletTransaction;
  wallet: Wallet;
}

// A movement in plain words (NFR-22).
export function describeTransaction(entry: WalletTransaction): string {
  switch (entry.type) {
    case 'top_up':
      return 'Top-up';
    case 'fare_payment':
      return 'Ride payment';
    case 'driver_credit':
      return 'Ride earnings';
    case 'cash_earning':
      return 'Cash earnings';
    case 'fine':
      return entry.reason === 'no_show' ? 'No-show fine' : 'Late-cancel fine';
  }
}

// Quick top-up amounts, in taka.
export const TOP_UP_PRESETS = ['100.00', '500.00', '1000.00'] as const;
