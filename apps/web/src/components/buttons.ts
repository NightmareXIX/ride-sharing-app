// Button styles shared by the signed-in screens. Disabled buttons show a wait cursor,
// since they are disabled while their request runs (NFR-37).
const base =
  'rounded-lg px-4 py-2.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-70';

export const primaryButton = `${base} bg-slate-900 text-white hover:bg-slate-700 focus-visible:outline-slate-900`;

export const secondaryButton = `${base} border border-slate-300 bg-white text-slate-700 hover:border-slate-900 focus-visible:outline-slate-900`;

export const dangerButton = `${base} bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600`;
