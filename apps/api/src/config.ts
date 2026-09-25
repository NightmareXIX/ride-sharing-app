import { z } from 'zod';

// Secrets and connection strings come only from the environment (NFR-11).
const databaseEnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// URL' }),
});

const envSchema = databaseEnvSchema
  .extend({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    // Signs the session cookie; anyone holding it can forge a login.
    SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
    // Browsers only send Secure cookies over HTTPS (NFR-5). Local Docker serves plain
    // http://localhost, so it turns this off explicitly.
    COOKIE_SECURE: z.stringbool().optional(),
    // OpenRouteService key for road distances. Unset (or empty, as compose passes it)
    // means every distance uses the straight-line fallback (NFR-13).
    ORS_API_KEY: z
      .string()
      .optional()
      .transform((key) => key || undefined),
    ORS_BASE_URL: z.url().default('https://api.openrouteservice.org'),
    // How far from their Tesla an idle driver sees ride requests (FR-D6, FR §2).
    DRIVER_SEARCH_RADIUS_KM: z.coerce.number().positive().max(20).default(2),
  })
  .transform((env) => ({
    ...env,
    COOKIE_SECURE: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
  }));

export type Config = z.infer<typeof envSchema>;
export type DatabaseConfig = z.infer<typeof databaseEnvSchema>;

function parseEnv<T extends z.ZodType>(schema: T, env: NodeJS.ProcessEnv): z.infer<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return parseEnv(envSchema, env);
}

// The migrate and seed CLIs only touch the database, so they don't need the API's secrets.
export function loadDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  return parseEnv(databaseEnvSchema, env);
}
