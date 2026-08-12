/**
 * Time gate for the daily push: each workspace configures its own hour in Beijing
 * time, and cron only runs it once that hour has arrived.
 *
 * China does not observe daylight saving time, so UTC+8 holds all year round and
 * no Intl/tzdata is needed — the offset can just be computed directly.
 */

/** The hour shown when there is no preferences row; matches the default of `ResearchPreferences.pushHour` in the schema. */
export const DEFAULT_PUSH_HOUR = 9;

/** Hour of the day in Beijing time (UTC+8), 0-23. */
export function beijingHour(date: Date): number {
  return (date.getUTCHours() + 8) % 24;
}

/**
 * Due check: any cron run that day passes as soon as Beijing time has reached or
 * gone past the configured hour.
 *
 * It uses `>=` rather than "exactly this hour" so that later runs can pick up a
 * partial left behind by an earlier one and retry failures; duplicate runs are
 * blocked by runDailyDigest's own skipped_done / locked handling.
 */
export function isDueForPush(pushHour: number, now: Date): boolean {
  return beijingHour(now) >= pushHour;
}
