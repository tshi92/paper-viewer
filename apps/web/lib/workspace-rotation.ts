/**
 * The run budget for one cron pass (RUN_BUDGET_MS) is shared by all workspaces,
 * which are processed serially until the budget runs out. With a fixed order (say
 * ascending workspaceId), the workspaces at the tail always wait for the ones
 * ahead of them, and once the budget falls short they are deferred day after day —
 * which means they never receive a digest at all.
 *
 * So the queue is rotated by an offset derived from dayOfYear each day: the spot
 * at the back of the line is taken by a different workspace in turn.
 */

const MS_PER_DAY = 86_400_000;

/** Day-of-year on the UTC scale, where January 1 is 1. */
export function dayOfYearUtc(date: Date): number {
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((today - yearStart) / MS_PER_DAY) + 1;
}

/** Rotate the queue left by the day's offset and return a new array (the input is not modified). */
export function rotateForDay<T>(items: readonly T[], date: Date): T[] {
  if (items.length === 0) {
    return [];
  }
  const offset = dayOfYearUtc(date) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}
