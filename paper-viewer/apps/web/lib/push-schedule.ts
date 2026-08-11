/**
 * 每日推送的时间闸门：workspace 自己配一个北京时间的钟点，cron 只在到点之后才跑它。
 *
 * 中国不用夏令时，UTC+8 常年恒定，所以不需要 Intl/tzdata，直接算即可。
 */

/** 没有偏好行时对外展示的钟点，和 schema 里 `ResearchPreferences.pushHour` 的默认值一致。 */
export const DEFAULT_PUSH_HOUR = 9;

/** 北京时间（UTC+8）的钟点，0-23。 */
export function beijingHour(date: Date): number {
  return (date.getUTCHours() + 8) % 24;
}

/**
 * 到点判定：当天任何一班 cron，只要北京时间已经到达或越过配置的钟点就放行。
 *
 * 用 `>=` 而不是「正好等于这一小时」，是为了让后面的班次能接着跑前一班留下的
 * partial、重试失败；重复运行由 runDailyDigest 自己的 skipped_done / locked 挡住。
 */
export function isDueForPush(pushHour: number, now: Date): boolean {
  return beijingHour(now) >= pushHour;
}
