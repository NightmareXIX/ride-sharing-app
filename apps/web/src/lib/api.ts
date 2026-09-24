// The browser only talks to this site; Next.js proxies /api/v1/* to the API, so the
// session cookie is first-party (NFR §1).
const API_BASE = '/api/v1';

export interface ErrorDetail {
  path: string;
  message: string;
}

// Every failed call becomes one of these, carrying the API's error envelope (NFR-35).
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Plain words for failures that never reached our error envelope (NFR-22).
const NETWORK_MESSAGE = "We can't reach the server. Check your connection and try again.";
const SERVER_MESSAGE = 'Something went wrong on our side. Please try again.';

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

function isErrorBody(body: unknown): body is ErrorBody {
  const error = (body as Partial<ErrorBody> | null)?.error;
  return typeof error?.code === 'string' && typeof error.message === 'string';
}

function isErrorDetail(value: unknown): value is ErrorDetail {
  const detail = value as Partial<ErrorDetail> | null;
  return typeof detail?.path === 'string' && typeof detail.message === 'string';
}

export async function api<T>(
  path: string,
  { method = 'GET', body }: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', NETWORK_MESSAGE);
  }

  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) return json as T;

  if (!isErrorBody(json)) throw new ApiError(res.status, 'UNKNOWN_ERROR', SERVER_MESSAGE);
  const details = Array.isArray(json.error.details) ? json.error.details.filter(isErrorDetail) : [];
  throw new ApiError(res.status, json.error.code, json.error.message, details);
}

// The first message for each field path, e.g. { email: 'must be a valid email address' }.
export function fieldErrors(err: ApiError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const { path, message } of err.details) errors[path] ??= message;
  return errors;
}
