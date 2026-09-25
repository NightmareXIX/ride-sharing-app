import { z } from 'zod';

// Long lists come in pages: ?cursor=…&limit=… (NFR-36, API Routes §1). The cursor is an
// opaque token holding the position of the last row sent, so a page never skips or
// repeats a row when new ones are added in front.

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

export interface PageRequest {
  // Rows come after this position; null for the first page.
  after: number | null;
  limit: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export function encodeCursor(position: number): string {
  return Buffer.from(String(position)).toString('base64url');
}

function decodeCursor(cursor: string): number | null {
  const text = Buffer.from(cursor, 'base64url').toString();
  return /^\d{1,15}$/.test(text) ? Number(text) : null;
}

const pageQuery = z.object({
  limit: z.coerce
    .number('must be a number')
    .int('must be a whole number')
    .min(1, 'must be at least 1')
    .max(MAX_PAGE_SIZE, `must be at most ${MAX_PAGE_SIZE}`)
    .default(DEFAULT_PAGE_SIZE),
  cursor: z
    .string()
    .transform((cursor, ctx) => {
      const after = decodeCursor(cursor);
      if (after === null) ctx.addIssue({ code: 'custom', message: 'is not a valid cursor' });
      return after;
    })
    .optional(),
});

// Reads ?cursor and ?limit; anything malformed is a 400 VALIDATION_ERROR.
export function parsePageQuery(query: unknown): PageRequest {
  const { limit, cursor } = pageQuery.parse(query);
  return { limit, after: cursor ?? null };
}

// Callers read one row more than the limit: if it exists, there is another page.
export function toPage<T>(rows: T[], limit: number, positionOf: (row: T) => number): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(positionOf(last)) : null,
  };
}
