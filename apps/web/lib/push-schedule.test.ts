import { describe, expect, it } from "vitest";
import { DEFAULT_PUSH_HOUR, beijingHour, isDueForPush } from "./push-schedule";

describe("beijingHour", () => {
  it("shifts UTC by +8 without any DST correction", () => {
    expect(beijingHour(new Date("2026-01-06T01:00:00Z"))).toBe(9);
    // Summer is +8 as well: China does not observe daylight saving time
    expect(beijingHour(new Date("2026-07-06T01:00:00Z"))).toBe(9);
  });

  it("wraps past midnight when UTC is already in the next Beijing day", () => {
    expect(beijingHour(new Date("2026-01-06T16:00:00Z"))).toBe(0);
    expect(beijingHour(new Date("2026-01-06T16:59:59Z"))).toBe(0);
    expect(beijingHour(new Date("2026-01-06T23:00:00Z"))).toBe(7);
  });

  it("covers both ends of the range", () => {
    expect(beijingHour(new Date("2026-01-06T15:00:00Z"))).toBe(23);
    expect(beijingHour(new Date("2026-01-06T00:00:00Z"))).toBe(8);
  });
});

describe("isDueForPush", () => {
  const at = (utc: string) => new Date(utc);

  it("holds a workspace back until its hour arrives", () => {
    // 9:00 Beijing time
    expect(isDueForPush(14, at("2026-01-06T01:00:00Z"))).toBe(false);
    expect(isDueForPush(10, at("2026-01-06T01:59:59Z"))).toBe(false);
  });

  it("releases it on the hour and on every later tick of the day", () => {
    expect(isDueForPush(9, at("2026-01-06T01:00:00Z"))).toBe(true);
    expect(isDueForPush(9, at("2026-01-06T01:30:00Z"))).toBe(true);
    expect(isDueForPush(9, at("2026-01-06T13:00:00Z"))).toBe(true);
  });

  it("treats hour 0 as always due and hour 23 as due only in the last Beijing hour", () => {
    expect(isDueForPush(0, at("2026-01-06T16:00:00Z"))).toBe(true);
    expect(isDueForPush(23, at("2026-01-06T14:59:00Z"))).toBe(false);
    expect(isDueForPush(23, at("2026-01-06T15:00:00Z"))).toBe(true);
  });
});

/**
 * The default is not a taste question. arXiv rebuilds its RSS once a day at
 * 04:00 UTC — 12:00 Beijing — and a run before that reads the previous day's
 * build. On a Monday that is the weekend's, which the feed itself declares
 * empty via <skipDays>Saturday, Sunday</skipDays>. A default in the morning
 * therefore ships a digest that is a day stale every day and blank on Mondays.
 */
describe("DEFAULT_PUSH_HOUR", () => {
  const ARXIV_RSS_REBUILD_HOUR_BEIJING = 12;

  it("falls after arXiv's daily feed rebuild", () => {
    expect(DEFAULT_PUSH_HOUR).toBeGreaterThan(ARXIV_RSS_REBUILD_HOUR_BEIJING);
  });

  it("leaves the rest of the day for the hourly retries to resume a partial run", () => {
    expect(isDueForPush(DEFAULT_PUSH_HOUR, new Date("2026-08-20T14:00:00Z"))).toBe(true);
    expect(DEFAULT_PUSH_HOUR).toBeLessThan(22);
  });
});
