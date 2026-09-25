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

// A driver has taken the booking and it isn't finished: it keeps the Tesla busy.
export const ASSIGNED_STATUSES = [
  'ACCEPTED',
  'DRIVER_ARRIVED',
  'STARTED',
] as const satisfies BookingStatus[];
export type AssignedStatus = (typeof ASSIGNED_STATUSES)[number];

export function isAssigned(status: BookingStatus): status is AssignedStatus {
  return (ASSIGNED_STATUSES as readonly BookingStatus[]).includes(status);
}

// Why a status changed, as recorded in the history (FR-R11).
export type TransitionReason =
  | 'requested'
  | 'passenger_cancel'
  | 'late_cancel'
  | 'accepted'
  | 'driver_arrived'
  | 'started'
  | 'completed'
  | 'driver_cancel';

// A passenger may cancel for free this long after acceptance (FR-P7). Used inside SQL, so
// the database clock decides (FR-R9, NFR-38).
export const FREE_CANCEL_WINDOW = '3 minutes';

export const PAYMENT_METHODS = ['cash', 'teslapay'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
