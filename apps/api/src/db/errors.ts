// Postgres error fields we branch on; see https://www.postgresql.org/docs/current/errcodes-appendix.html
interface PgError {
  code: string;
  constraint?: string;
}

const UNIQUE_VIOLATION = '23505';

function isPgError(err: Error): err is Error & PgError {
  return typeof (err as Error & Partial<PgError>).code === 'string';
}

// Drizzle wraps driver errors, so the pg error may sit further down the cause chain.
function findPgError(err: unknown): PgError | undefined {
  for (let current = err; current instanceof Error; current = current.cause) {
    if (isPgError(current)) return current;
  }
  return undefined;
}

// True when the database rejected a write because it broke the named unique constraint.
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  const pgError = findPgError(err);
  return pgError?.code === UNIQUE_VIOLATION && pgError.constraint === constraint;
}
