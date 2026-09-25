import { secondaryButton } from './buttons';

// The foot of a paged list (NFR-22, NFR-36): what went wrong, and a button that reads the
// next page, or tries again. With nothing shown yet, trying again reads the first page.
export function ListFooter({
  hasMore,
  loading,
  error,
  onLoadMore,
}: {
  hasMore: boolean;
  loading: boolean;
  error: string;
  onLoadMore: () => void;
}) {
  return (
    <>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {(hasMore || error) && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loading}
          className={`mt-3 w-full ${secondaryButton}`}
        >
          {loading ? 'Loading…' : error ? 'Try again' : 'Load more'}
        </button>
      )}
    </>
  );
}
