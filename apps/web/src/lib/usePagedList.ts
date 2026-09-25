'use client';

import { useCallback, useState } from 'react';

// One page of a long list, as the API returns it once unwrapped (NFR-36).
export interface PageOf<T> {
  items: T[];
  nextCursor: string | null;
}

// A list read a page at a time: the rows shown so far, and a way to read the next page.
// `readPage` gets the cursor of the page to read, or null for the first.
export function usePagedList<T>(readPage: (cursor: string | null) => Promise<PageOf<T>>) {
  // Null until the first page arrives.
  const [items, setItems] = useState<T[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Shows a first page read elsewhere, replacing whatever was shown.
  const showFirst = useCallback((page: PageOf<T>) => {
    setItems(page.items);
    setCursor(page.nextCursor);
    setError('');
  }, []);

  // Reads the page after the last one shown. With no cursor, it reads the first page again.
  async function loadMore() {
    setLoading(true);
    setError('');
    try {
      const page = await readPage(cursor);
      setItems((shown) => [...(cursor ? (shown ?? []) : []), ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return { items, hasMore: cursor !== null, loading, error, setError, showFirst, loadMore };
}
