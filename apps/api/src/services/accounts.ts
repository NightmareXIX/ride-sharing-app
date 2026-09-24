import { hashPassword } from '../auth/password.js';
import type { Database } from '../db/client.js';
import { isUniqueViolation } from '../db/errors.js';
import { users, vehicles, wallets, type User, type Vehicle } from '../db/schema/index.js';
import { AppError } from '../http/errors.js';

// What the signed-in user sees about themselves: the body of GET /me.
export interface Account {
  user: Pick<User, 'id' | 'name' | 'email' | 'gender' | 'role' | 'createdAt'>;
  // Money travels as a string such as "0.00", never a float.
  wallet: { balance: string };
  vehicle: Pick<Vehicle, 'id' | 'name' | 'capacity'> | null;
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

      return { user, wallet, vehicle };
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
