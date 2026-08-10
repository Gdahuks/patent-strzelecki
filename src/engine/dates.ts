/**
 * A day's date rendered in Polish, assembled from the parts of an ISO string.
 *
 * Not via `new Date(iso)`: that parses a bare date as UTC, so west of Greenwich it would
 * push the date back by a day — „stan na 2026-03-30" would show 29 March. Splitting the
 * string into numbers and building the date with the local constructor sidesteps that
 * without depending on the timezone.
 *
 * The fallback is the input unchanged: a date coming from the bundle or from the build
 * config might one day arrive in a different format, and the raw string is a better
 * result than "Invalid Date".
 */
export function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString('pl-PL');
}
