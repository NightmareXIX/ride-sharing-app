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
  | 'INSUFFICIENT_BALANCE';

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
