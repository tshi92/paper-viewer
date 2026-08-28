import { describe, expect, it } from "vitest";
import { DEFAULT_PUSH_HOUR, beijingHour, isDueForPush, isPushDay, nextPushDay } from "./push-schedule";

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

describe("isPushDay", () => {
  it("covers Monday through Friday in Beijing time", () => {
    // 2026-08-24 is a Monday, so this walks Mon..Fri at midday Beijing.
    for (let day = 24; day <= 28; day += 1) {
      expect(isPushDay(new Date(`2026-08-${day}T04:00:00Z`))).toBe(true);
    }
  });

  it("excludes the weekend, which arXiv's feed skips", () => {
    expect(isPushDay(new Date("2026-08-29T04:00:00Z"))).toBe(false);
    expect(isPushDay(new Date("2026-08-30T04:00:00Z"))).toBe(false);
  });

  it("reads the Beijing day, not the UTC one", () => {
    // Friday 23:00 UTC is already Saturday 07:00 in Beijing.
    expect(isPushDay(new Date("2026-08-28T23:00:00Z"))).toBe(false);
    // And Sunday 17:00 UTC is Monday 01:00 there.
    expect(isPushDay(new Date("2026-08-30T17:00:00Z"))).toBe(true);
  });
});

describe("nextPushDay", () => {
  const beijingWeekday = (date: Date) =>
    new Date(date.getTime() + 8 * 60 * 60 * 1000).getUTCDay();

  it("is the same day when that day already runs", () => {
    // Wednesday 12:00 Beijing.
    const wednesday = new Date("2026-08-26T04:00:00Z");
    expect(nextPushDay(wednesday).getTime()).toBe(wednesday.getTime());
  });

  it("carries the weekend over to Monday", () => {
    // Saturday and Sunday, both at midday Beijing, land on Monday.
    expect(beijingWeekday(nextPushDay(new Date("2026-08-29T04:00:00Z")))).toBe(1);
    expect(beijingWeekday(nextPushDay(new Date("2026-08-30T04:00:00Z")))).toBe(1);
  });

  it("follows the Beijing day, so a Friday night in UTC is already the weekend", () => {
    // Friday 23:00 UTC is Saturday 07:00 in Beijing: the next run is Monday.
    expect(beijingWeekday(nextPushDay(new Date("2026-08-28T23:00:00Z")))).toBe(1);
  });
});
