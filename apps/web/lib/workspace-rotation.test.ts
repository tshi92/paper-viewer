import { describe, expect, it } from "vitest";
import { dayOfYearUtc, rotateForDay } from "./workspace-rotation";

const items = ["a", "b", "c", "d"];

describe("dayOfYearUtc", () => {
  it("counts January 1st as day 1", () => {
    expect(dayOfYearUtc(new Date("2026-01-01T00:00:00Z"))).toBe(1);
  });

  it("counts across months and leap years", () => {
    expect(dayOfYearUtc(new Date("2026-12-31T23:59:59Z"))).toBe(365);
    expect(dayOfYearUtc(new Date("2028-12-31T00:00:00Z"))).toBe(366);
  });
});

describe("rotateForDay", () => {
  it("puts a different workspace last on consecutive days", () => {
    const lastOf = (day: string) => rotateForDay(items, new Date(`${day}T00:00:00Z`)).at(-1);

    expect(lastOf("2026-01-01")).toBe("a");
    expect(lastOf("2026-01-02")).toBe("b");
    expect(lastOf("2026-01-03")).toBe("c");
    expect(lastOf("2026-01-04")).toBe("d");
  });

  it("rotates left by dayOfYear % length", () => {
    // 2026-01-03 是第 3 天，3 % 4 === 3
    expect(rotateForDay(items, new Date("2026-01-03T00:00:00Z"))).toEqual(["d", "a", "b", "c"]);
  });

  it("keeps every element exactly once", () => {
    const rotated = rotateForDay(items, new Date("2026-06-17T09:00:00Z"));
    expect([...rotated].sort()).toEqual([...items].sort());
  });

  it("does not mutate the input", () => {
    const original = [...items];
    rotateForDay(items, new Date("2026-06-17T09:00:00Z"));
    expect(items).toEqual(original);
  });

  it("handles empty and single-element queues", () => {
    expect(rotateForDay([], new Date("2026-06-17T09:00:00Z"))).toEqual([]);
    expect(rotateForDay(["only"], new Date("2026-06-17T09:00:00Z"))).toEqual(["only"]);
  });
});
