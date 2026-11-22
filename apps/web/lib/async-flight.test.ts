// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const snapshots: Array<() => unknown> = [];
vi.mock("react", () => ({
  // Capture the snapshot getter so the store can be read without rendering.
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => {
    snapshots.push(getSnapshot);
    return getSnapshot();
  }
}));

const { endFlight, setFlightProgress, startFlight, useFlightProgress } = await import("./async-flight");

describe("flight progress", () => {
  it("is unknown until the flight reports how far along it is", () => {
    startFlight("upload");
    expect(useFlightProgress("upload")).toBeNull();
    setFlightProgress("upload", 0.4);
    expect(useFlightProgress("upload")).toBe(0.4);
  });

  it("keeps the fraction within 0..1 so the bar never overflows", () => {
    setFlightProgress("upload", 1.3);
    expect(useFlightProgress("upload")).toBe(1);
  });

  it("goes back to unknown when the measurable part is over", () => {
    setFlightProgress("upload", null);
    expect(useFlightProgress("upload")).toBeNull();
  });

  it("does not leak into the next flight under the same key", () => {
    setFlightProgress("upload", 0.9);
    endFlight("upload");
    startFlight("upload");
    expect(useFlightProgress("upload")).toBeNull();
    endFlight("upload");
  });
});
