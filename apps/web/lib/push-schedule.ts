/**
 * Time gate for the daily push: each workspace configures its own hour in Beijing
 * time, and cron only runs it once that hour has arrived.
 *
 * China does not observe daylight saving time, so UTC+8 holds all year round and
 * no Intl/tzdata is needed — the offset can just be computed directly.
 */

/**
 * The hour shown when there is no preferences row; matches the default of
 * `ResearchPreferences.pushHour` in the schema.
 *
 * 13:00 rather than the morning because arXiv rebuilds its RSS once a day at
 * 04:00 UTC (12:00 Beijing). A digest run before that reads the PREVIOUS day's
 * build — which on a Monday is the weekend's, and the feed itself declares
 * `<skipDays>Saturday, Sunday</skipDays>`, so it holds nothing at all. An
 * earlier hour is not merely earlier: it is a day stale every day, empty on
 * Mondays, and it drops Friday's build entirely, since Friday's own run has
 * already completed from Thursday's build by the time Friday's is published.
 */
export const DEFAULT_PUSH_HOUR = 13;

/** Hour of the day in Beijing time (UTC+8), 0-23. */
export function beijingHour(date: Date): number {
  return (date.getUTCHours() + 8) % 24;
}

/**
 * Beijing-time weekday check. The schedule runs Monday to Friday only — arXiv's
 * feed declares `<skipDays>Saturday, Sunday</skipDays>` — so on a weekend there
 * is no edition still to come, and telling a reader to wait for one would be a
 * standing lie on exactly the label meant to keep them oriented.
 */
export function isPushDay(date: Date): boolean {
  const beijingDay = new Date(date.getTime() + 8 * 60 * 60 * 1000).getUTCDay();
  return beijingDay >= 1 && beijingDay <= 5;
}

/**
 * The next Beijing day the digest runs on, counted from `date`: that same day
 * when it is a weekday, otherwise the Monday after the weekend. Returned as a
 * Date whose Beijing calendar day is the answer, so a caller can format its
 * weekday name in the reader's locale.
 */
export function nextPushDay(date: Date): Date {
  const beijingDay = new Date(date.getTime() + 8 * 60 * 60 * 1000).getUTCDay();
  const skip = beijingDay === 6 ? 2 : beijingDay === 0 ? 1 : 0;
  return new Date(date.getTime() + skip * 24 * 60 * 60 * 1000);
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
