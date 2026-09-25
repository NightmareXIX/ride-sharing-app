import Link from 'next/link';

// Compact, on narrow screens only the mark shows; the name stays for screen readers.
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <span
        aria-hidden
        className="grid size-7 shrink-0 place-items-center rounded-md bg-slate-900 text-xs font-bold text-white"
      >
        TP
      </span>
      <span className={compact ? 'sr-only sm:not-sr-only' : undefined}>Dhaka Tesla Pool</span>
    </Link>
  );
}
