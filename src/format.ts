/*
 * Dates and numbers in the app's language (English), the same on every computer, instead of
 * the system's language: a Turkish Mac would otherwise show "25 Kas 2026" next to English text.
 * Times are in the local time zone.
 */

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const pad2 = (n: number) => String(n).padStart(2, '0');

/** "25 Nov 2026  14:05" from UNIX seconds. */
export function formatDateTime(seconds: number): string {
  const d = new Date(seconds * 1000);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}  ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** "14:05" from UNIX seconds. */
export function formatClockTime(seconds: number): string {
  const d = new Date(seconds * 1000);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** "1,000" */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}
