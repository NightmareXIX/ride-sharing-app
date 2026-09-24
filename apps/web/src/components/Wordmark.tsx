import Link from 'next/link';

export function Wordmark() {
  return (
    <Link href="/" className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <span
        aria-hidden
        className="grid size-7 place-items-center rounded-md bg-slate-900 text-xs font-bold text-white"
      >
        TP
      </span>
      Dhaka Tesla Pool
    </Link>
  );
}
