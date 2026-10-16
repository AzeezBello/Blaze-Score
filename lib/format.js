// Small, pure date and number helpers shared by the browser app and the tests.

const pad = (n) => String(n).padStart(2, '0');

/** The local calendar date as YYYY-MM-DD: what a user means by "today". */
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Shift a YYYY-MM-DD string by n days. Pure string arithmetic, no timezone drift. */
export const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

/** True for a real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
export function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(s + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 11 -> "11th", 22 -> "22nd". */
export function ordinal(n) {
  const abs = Math.abs(n);
  const tens = abs % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][abs % 10] ?? 'th');
  return `${n}${suffix}`;
}
