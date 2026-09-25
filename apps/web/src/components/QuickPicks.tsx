import { QUICK_PICKS } from '@/lib/places';
import type { Place } from '@/lib/geo';

// Well-known spots as buttons, for anyone who'd rather not tap the map.
export function QuickPicks({
  onPick,
  selected,
  disabled,
}: {
  onPick: (place: Place) => void;
  selected?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {QUICK_PICKS.map((place) => (
        <button
          key={place.label}
          type="button"
          disabled={disabled}
          aria-pressed={selected === place.label}
          onClick={() => onPick(place)}
          className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:border-slate-900 focus-visible:outline-2 focus-visible:outline-slate-900 disabled:opacity-60 aria-pressed:border-slate-900 aria-pressed:bg-slate-900 aria-pressed:text-white"
        >
          {place.label}
        </button>
      ))}
    </div>
  );
}
