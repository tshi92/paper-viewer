import { describe, expect, it } from "vitest";
import { runAdaptivePool } from "./adaptive-pool";

/** Resolves on the next macrotask, letting every started handler interleave. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("runAdaptivePool", () => {
  it("runs at most `concurrency` handlers at once and handles every item", async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];

    const result = await runAdaptivePool({
      items: [1, 2, 3, 4, 5, 6, 7],
      concurrency: 3,
      shouldStop: () => false,
      handle: async (item) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await tick();
        inFlight -= 1;
        seen.push(item);
        return "done";
      }
    });

    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
    expect(result).toEqual({ stopped: false, concurrency: 3 });
  });

  it("is exactly the old serial loop at concurrency 1", async () => {
    let inFlight = 0;
    let peak = 0;
    const order: number[] = [];

    await runAdaptivePool({
      items: [1, 2, 3],
      concurrency: 1,
      shouldStop: () => false,
      handle: async (item) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await tick();
        inFlight -= 1;
        order.push(item);
        return "done";
      }
    });

    expect(peak).toBe(1);
    expect(order).toEqual([1, 2, 3]);
  });

  it("halves the parallelism and retries the item when the provider pushes back", async () => {
    const attempts = new Map<number, number>();

    const result = await runAdaptivePool({
      items: [1, 2, 3, 4],
      concurrency: 4,
      shouldStop: () => false,
      handle: async (item) => {
        const n = (attempts.get(item) ?? 0) + 1;
        attempts.set(item, n);
        // Item 3 is rate-limited on its first try and clean on its second.
        return item === 3 && n === 1 ? "rate-limited" : "done";
      }
    });

    expect(attempts.get(3)).toBe(2);
    expect(result.concurrency).toBe(2);
    expect(result.stopped).toBe(false);
  });

  it("collapses to 1 when everything is rate-limited, and marks the last attempt final", async () => {
    const finals: boolean[] = [];

    const result = await runAdaptivePool({
      items: [1, 2, 3, 4, 5],
      concurrency: 8,
      shouldStop: () => false,
      handle: async (_item, isFinalAttempt) => {
        finals.push(isFinalAttempt);
        return "rate-limited";
      }
    });

    expect(result.concurrency).toBe(1);
    // Every item gets a first attempt (not final) and a second (final).
    expect(finals.filter((f) => f).length).toBe(5);
    expect(finals.length).toBe(10);
  });

  it("stops picking new items when told to, leaving the rest untouched", async () => {
    const seen: number[] = [];
    let stop = false;

    const result = await runAdaptivePool({
      items: [1, 2, 3, 4, 5],
      concurrency: 1,
      shouldStop: () => stop,
      handle: async (item) => {
        seen.push(item);
        if (item === 2) stop = true;
        return "done";
      }
    });

    expect(seen).toEqual([1, 2]);
    expect(result.stopped).toBe(true);
  });
});
