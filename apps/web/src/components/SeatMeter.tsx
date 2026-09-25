// How full the Tesla is: one pip per seat, filled while a passenger holds it (FR-R2).
export function SeatMeter({ capacity, taken }: { capacity: number; taken: number }) {
  const label = `${taken} of ${capacity} ${capacity === 1 ? 'seat' : 'seats'} taken`;
  return (
    <div className="flex items-center gap-3">
      <div aria-hidden className="flex gap-1.5">
        {Array.from({ length: capacity }, (_, seat) => (
          <span
            key={seat}
            className={`h-2.5 w-6 rounded-full ${seat < taken ? 'bg-slate-900' : 'bg-slate-200'}`}
          />
        ))}
      </div>
      <p className="text-sm whitespace-nowrap text-slate-600 tabular-nums">{label}</p>
    </div>
  );
}
