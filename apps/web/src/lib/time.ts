// Times arrive in UTC and are always shown in Dhaka time (NFR-23).
const dhakaTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dhaka',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

// e.g. "Thu 24 Sept, 8:41 am" for 2026-09-24T02:41:00Z
export function formatDhakaTime(iso: string): string {
  return dhakaTime.format(new Date(iso));
}
