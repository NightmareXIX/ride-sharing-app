// What the lines on a map mean, naming only what is drawn now (route-paths LLD §4).
export interface LegendItem {
  key: string;
  kind: 'trip' | 'preview' | 'approximate';
  label: string;
}

const SWATCHES: Record<LegendItem['kind'], string> = {
  trip: 'h-1.5 w-5 rounded-full bg-slate-900/80',
  preview: 'h-1 w-5 rounded-full bg-violet-600',
  approximate: 'w-5 border-t-2 border-dashed border-slate-500',
};

export function MapLegend({ items }: { items: LegendItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-slate-600">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-2">
          <span aria-hidden className={`shrink-0 ${SWATCHES[item.kind]}`} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
