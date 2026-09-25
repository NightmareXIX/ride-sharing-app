// Error codes shared by every route (API Routes §10). Feature phases add their own.
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'WRONG_ROLE'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR'
  // Accounts (phase 1)
  | 'EMAIL_TAKEN'
  | 'INVALID_CREDENTIALS'
  // Ride requests (phase 2)
  | 'LOCATION_REQUIRED'
  | 'ACTIVE_BOOKING_EXISTS'
  | 'NEGATIVE_BALANCE'
  | 'INSUFFICIENT_BALANCE'
  | 'INVALID_TRANSITION'
  // Driver flow (phase 3)
  | 'ALREADY_CLAIMED'
  | 'SEATS_UNAVAILABLE'
  | 'HAS_ACTIVE_BOOKINGS'
  | 'NO_LONGER_MATCHES'
  | 'DRIVER_OFFLINE'
  // Seats and concurrency (phase 4)
  | 'POOL_CHANGED'
  // Pooling (phase 5)
  | 'OUT_OF_STOP_ORDER'
  // TeslaPay and fines (phase 6)
  | 'BALANCE_LIMIT';

// Every error response has this shape (NFR-35).
export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

// An expected failure: thrown by services and routes, turned into a response by errorHandler.
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
