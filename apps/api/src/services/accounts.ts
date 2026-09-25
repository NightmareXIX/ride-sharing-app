import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { hashPassword, verifyPassword } from '../auth/password.js';
import type { Database } from '../db/client.js';
import { isUniqueViolation } from '../db/errors.js';
import { users, vehicles, wallets, type User, type Vehicle } from '../db/schema/index.js';
import { AppError } from '../http/errors.js';
import { getCurrentBooking, type BookingView } from './bookings.js';

// What the signed-in user sees about themselves: the body of GET /me.
export interface Account {
  user: Pick<User, 'id' | 'name' | 'email' | 'gender' | 'role' | 'createdAt'>;
  // Money travels as a string such as "0.00", never a float.
  wallet: { balance: string };
  vehicle: Pick<Vehicle, 'id' | 'name' | 'capacity'> | null;
  // The passenger's active ride, if any. Always null for a driver.
  currentBooking: BookingView | null;
}

interface SignUpFields {
  name: string;
  email: string;
  password: string;
  gender: User['gender'];
}

export type SignUpInput =
  | (SignUpFields & { role: 'passenger' })
  | (SignUpFields & { role: 'driver'; vehicle: { name: string; capacity: number } });

const accountUserColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  gender: users.gender,
  role: users.role,
  createdAt: users.createdAt,
};

// Creates the user, their wallet (FR-W1) and, for a driver, their Tesla (FR-D1) in one
// transaction, so a failure leaves no half-made account behind (NFR-14).
export async function signUp(db: Database, input: SignUpInput): Promise<Account> {
  // Hash before opening the transaction: bcrypt is slow and shouldn't hold a connection.
  const passwordHash = await hashPassword(input.password);
  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          name: input.name,
          email: input.email,
          passwordHash,
          gender: input.gender,
          role: input.role,
        })
        .returning(accountUserColumns);
      if (!user) throw new Error('Inserting the user returned no row');

      const [wallet] = await tx
        .insert(wallets)
        .values({ userId: user.id })
        .returning({ balance: wallets.balance });
      if (!wallet) throw new Error('Inserting the wallet returned no row');

      let vehicle: Account['vehicle'] = null;
      if (input.role === 'driver') {
        const [inserted] = await tx
          .insert(vehicles)
          .values({ driverId: user.id, ...input.vehicle })
          .returning({ id: vehicles.id, name: vehicles.name, capacity: vehicles.capacity });
        vehicle = inserted ?? null;
      }

      return { user, wallet, vehicle, currentBooking: null };
    });
  } catch (err) {
    // The unique constraint decides, not a lookup first, so two racing sign-ups with one
    // email can't both succeed.
    if (isUniqueViolation(err, 'users_email_unique')) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
    }
    throw err;
  }
}

// A hash of a random password, compared against when the email is unknown so that a
// wrong email takes as long as a wrong password and doesn't reveal who has an account.
let dummyHash: Promise<string> | undefined;

function invalidCredentials(): AppError {
  return new AppError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.');
}

// Checks the password (FR-P2, FR-D2). Unknown email and wrong password fail identically.
export async function logIn(db: Database, email: string, password: string): Promise<Account> {
  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email));

  const passwordHash = user?.passwordHash ?? (await (dummyHash ??= hashPassword(randomUUID())));
  const matches = await verifyPassword(password, passwordHash);
  if (!user || !matches) throw invalidCredentials();

  const account = await getAccount(db, user.id);
  if (!account) throw invalidCredentials();
  return account;
}

// Null when the user doesn't exist, e.g. a valid session for a deleted account.
export async function getAccount(db: Database, userId: string): Promise<Account | null> {
  const [row] = await db
    .select({
      user: accountUserColumns,
      balance: wallets.balance,
      vehicleId: vehicles.id,
      vehicleName: vehicles.name,
      vehicleCapacity: vehicles.capacity,
    })
    .from(users)
    .innerJoin(wallets, eq(wallets.userId, users.id))
    .leftJoin(vehicles, eq(vehicles.driverId, users.id))
    .where(eq(users.id, userId));
  if (!row) return null;

  return {
    user: row.user,
    wallet: { balance: row.balance },
    vehicle:
      row.vehicleId !== null && row.vehicleName !== null && row.vehicleCapacity !== null
        ? { id: row.vehicleId, name: row.vehicleName, capacity: row.vehicleCapacity }
        : null,
    currentBooking: row.user.role === 'passenger' ? await getCurrentBooking(db, userId) : null,
  };
}
