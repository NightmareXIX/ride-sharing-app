// A booking's lifecycle (FR §6). All six states exist from the start, so later phases
// never need to alter the enum.
export const BOOKING_STATUSES = [
  'REQUESTED',
  'ACCEPTED',
  'DRIVER_ARRIVED',
  'STARTED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

// No transition leaves these (FR §6).
export const FINAL_STATUSES = ['COMPLETED', 'CANCELLED'] as const satisfies BookingStatus[];

export const PAYMENT_METHODS = ['cash', 'teslapay'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
