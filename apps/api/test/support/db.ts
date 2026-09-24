// Tests use their own database so they never touch demo data. The default points at the
// Postgres from `docker compose up db`; CI sets TEST_DATABASE_URL to its service container.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://tesla:tesla@localhost:5432/tesla_pool_test';

// Nothing listens on port 1, so connections are refused immediately.
export const UNREACHABLE_DATABASE_URL = 'postgres://nobody:nothing@127.0.0.1:1/nowhere';
