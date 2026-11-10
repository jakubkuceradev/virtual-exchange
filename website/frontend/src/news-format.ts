/**
 * @implemented-ui Display formatting for news times and event countdowns.
 * Pure functions of their arguments; times are epoch milliseconds, shown in local time.
 */

const pad = (value: number) => String(value).padStart(2, '0');

/** Time until an announced event: `in 04:05`, `in 01:04:05`, `in 2d 03:04:05`; null once passed. */
export function countdown(eventAt: number, now: number): string | null {
  const total = Math.ceil((eventAt - now) / 1000);
  if (total <= 0) return null;
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const clock =
    days || hours
      ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
      : `${pad(minutes)}:${pad(seconds)}`;
  return `in ${days ? `${days}d ` : ''}${clock}`;
}

/** `14:05:09` today, otherwise `9 Nov 14:05:09`. */
export function newsTime(at: number, now: number): string {
  const date = new Date(at);
  const clock = date.toLocaleTimeString('en-GB');
  return date.toDateString() === new Date(now).toDateString()
    ? clock
    : `${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${clock}`;
}

/** Items not yet displayed on the News screen. */
export function unread(
  items: readonly { id: string }[],
  seen: ReadonlySet<string>,
): number {
  let count = 0;
  for (const item of items) if (!seen.has(item.id)) count++;
  return count;
}

/** Navigation badge text: hidden at zero, capped at 99+. */
export const badge = (count: number) =>
  count <= 0 ? null : count > 99 ? '99+' : String(count);
