// Formats an API money string such as "1250.5" or "-30.00" as "৳ 1,250.50" (NFR-23).
// Works on the digits as text, so no amount ever passes through a float.
export function formatTaka(amount: string): string {
  const negative = amount.startsWith('-');
  const [whole = '0', fraction = ''] = amount.replace(/^[-+]/, '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = fraction.padEnd(2, '0').slice(0, 2);
  return `${negative ? '-' : ''}৳ ${grouped}.${cents}`;
}
