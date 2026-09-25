import type { Tone } from '@/lib/history';

const TONES: Record<Tone, string> = {
  good: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  warn: 'bg-amber-50 text-amber-800 ring-amber-200',
  plain: 'bg-slate-50 text-slate-700 ring-slate-200',
};

// How a ride or a passenger's part in a trip ended.
export function StatusBadge({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${TONES[tone]}`}
    >
      {label}
    </span>
  );
}
