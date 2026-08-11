/**
 * cron 一轮的运行预算（RUN_BUDGET_MS）是所有 workspace 共享的，串行跑到预算耗尽为止。
 * 顺序如果固定（比如 workspaceId 升序），排在尾部的 workspace 永远等前面的跑完，
 * 预算一旦不够就天天被 deferred，等于永远收不到 digest。
 *
 * 所以每天按 dayOfYear 把队列旋转一个偏移量：垫底的位置在 workspace 之间轮流坐。
 */

const MS_PER_DAY = 86_400_000;

/** UTC 口径的 day-of-year，1 月 1 日为 1。 */
export function dayOfYearUtc(date: Date): number {
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((today - yearStart) / MS_PER_DAY) + 1;
}

/** 把队列按当天的偏移量左旋，返回新数组（不改输入）。 */
export function rotateForDay<T>(items: readonly T[], date: Date): T[] {
  if (items.length === 0) {
    return [];
  }
  const offset = dayOfYearUtc(date) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}
