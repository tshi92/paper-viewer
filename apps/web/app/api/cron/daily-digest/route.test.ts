import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const runDailyDigest = vi.fn();
const getEnv = vi.fn();

vi.mock("@paper-viewer/db", () => ({ prisma: { researchPreferences: { findMany } } }));
vi.mock("@/lib/daily-digest", () => ({ runDailyDigest }));
vi.mock("@/lib/env", () => ({ getEnv }));

const { GET } = await import("./route");

const SECRET = "cron-secret-with-enough-length";
const AUTHORIZED = { headers: { authorization: `Bearer ${SECRET}` } };

function request(url: string, init?: { headers?: Record<string, string> }) {
  return new Request(url, init);
}

/** Defaults to pushHour=9, which together with the pinned "now" below (17:00 Beijing time) always counts as due. */
function prefsOf(...workspaceIds: string[]) {
  return workspaceIds.map((workspaceId) => ({ workspaceId, pushHour: 9 }));
}

function ok(processed: number) {
  return { status: "done" as const, processed, remaining: 0 };
}

beforeEach(() => {
  vi.useFakeTimers();
  // The execution order rotates daily, so "today" is pinned to day 6: 6 % n === 0
  // (n = 1/2/3) gives an offset of 0, which is what makes the order expectations
  // in the cases below meaningful.
  // The hour is pinned as well: 09:00Z = 17:00 Beijing time, so the default
  // pushHour=9 is long past due and the due gate does not change the results
  // depending on when the tests actually run.
  vi.setSystemTime(new Date("2026-01-06T09:00:00Z"));
  getEnv.mockReturnValue({ CRON_SECRET: SECRET });
  findMany.mockResolvedValue(prefsOf("ws-1"));
  runDailyDigest.mockResolvedValue(ok(2));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("cron auth", () => {
  it("hides the endpoint entirely when no secret is configured", async () => {
    getEnv.mockReturnValue({ CRON_SECRET: undefined });
    const response = await GET(request("http://localhost/api/cron/daily-digest", AUTHORIZED));
    expect(response.status).toBe(404);
    expect(runDailyDigest).not.toHaveBeenCalled();
  });

  it("rejects a missing, malformed or wrong Authorization header", async () => {
    const headers = [
      undefined,
      { authorization: `Basic ${SECRET}` },
      { authorization: "Bearer wrong-secret-of-same-len" },
      { authorization: "Bearer short" }
    ];
    for (const header of headers) {
      const response = await GET(
        request("http://localhost/api/cron/daily-digest", header ? { headers: header } : undefined)
      );
      expect(response.status).toBe(401);
    }
    expect(runDailyDigest).not.toHaveBeenCalled();
  });

  it("runs every workspace that has research preferences and reports each result", async () => {
    findMany.mockResolvedValue(prefsOf("ws-1", "ws-2"));
    const response = await GET(request("http://localhost/api/cron/daily-digest", AUTHORIZED));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      results: [
        { workspaceId: "ws-1", status: "done", processed: 2, remaining: 0 },
        { workspaceId: "ws-2", status: "done", processed: 2, remaining: 0 }
      ]
    });
    expect(runDailyDigest).toHaveBeenCalledTimes(2);
  });

  it("passes a shared deadline so one slow workspace cannot eat the whole runtime", async () => {
    findMany.mockResolvedValue(prefsOf("ws-1", "ws-2"));
    await GET(request("http://localhost/api/cron/daily-digest", AUTHORIZED));

    const deadlines = runDailyDigest.mock.calls.map((call) => call[1].deadline);
    expect(deadlines[0]).toBe(deadlines[1]);
  });
});

describe("cron budget", () => {
  it("defers the workspaces it no longer has time for instead of dropping them", async () => {
    findMany.mockResolvedValue(prefsOf("ws-1", "ws-2", "ws-3"));
    runDailyDigest.mockImplementation(async () => {
      vi.advanceTimersByTime(200_000);
      return ok(1);
    });

    const response = await GET(request("http://localhost/api/cron/daily-digest", AUTHORIZED));

    await expect(response.json()).resolves.toMatchObject({
      results: [
        { workspaceId: "ws-1", status: "done" },
        { workspaceId: "ws-2", status: "done" },
        { workspaceId: "ws-3", status: "deferred", processed: 0, remaining: 0 }
      ]
    });
    expect(runDailyDigest).toHaveBeenCalledTimes(2);
  });
});

describe("workspace rotation", () => {
  it("starts from a different workspace each day so the tail is not always deferred", async () => {
    findMany.mockResolvedValue(prefsOf("ws-1", "ws-2", "ws-3"));

    vi.setSystemTime(new Date("2026-01-07T09:00:00Z")); // day 7, and 7 % 3 === 1
    await GET(request("http://localhost/api/cron/daily-digest", AUTHORIZED));
    expect(runDailyDigest.mock.calls.map((call) => call[0])).toEqual(["ws-2", "ws-3", "ws-1"]);

    runDailyDigest.mockClear();
    vi.setSystemTime(new Date("2026-01-08T09:00:00Z")); // day 8, and 8 % 3 === 2
    await GET(request("http://localhost/api/cron/daily-digest", AUTHORIZED));
    expect(runDailyDigest.mock.calls.map((call) => call[0])).toEqual(["ws-3", "ws-1", "ws-2"]);
  });
});

describe("push hour gating", () => {
  /** 09:00 Beijing time (= 01:00Z); the cases below pick their pushHour around this hour. */
  const beijingNine = new Date("2026-01-06T01:00:00Z");

  it("skips a workspace whose Beijing push hour has not arrived yet", async () => {
    vi.setSystemTime(beijingNine);
    findMany.mockResolvedValue([{ workspaceId: "ws-1", pushHour: 14 }]);

    const response = await GET(request("http://localhost/api/cron/daily-digest", AUTHORIZED));

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      results: [{ workspaceId: "ws-1", status: "not_due", processed: 0, remaining: 0 }]
    });
    expect(runDailyDigest).not.toHaveBeenCalled();
  });

  it("runs a workspace on its hour and on every later tick of the day", async () => {
    for (const [now, pushHour] of [
      [beijingNine, 9], // exactly on the hour
      [beijingNine, 7], // earlier than now
      [new Date("2026-01-06T05:00:00Z"), 9] // 13:00 Beijing time, a later run on the same day
    ] as const) {
      runDailyDigest.mockClear();
      vi.setSystemTime(now);
      findMany.mockResolvedValue([{ workspaceId: "ws-1", pushHour }]);

      const response = await GET(request("http://localhost/api/cron/daily-digest", AUTHORIZED));

      await expect(response.json()).resolves.toMatchObject({
        results: [{ workspaceId: "ws-1", status: "done" }]
      });
      expect(runDailyDigest).toHaveBeenCalledWith("ws-1", expect.anything());
    }
  });

  it("gates each workspace on its own hour within the same run", async () => {
    vi.setSystemTime(beijingNine);
    findMany.mockResolvedValue([
      { workspaceId: "ws-1", pushHour: 9 },
      { workspaceId: "ws-2", pushHour: 20 }
    ]);

    const response = await GET(request("http://localhost/api/cron/daily-digest", AUTHORIZED));

    await expect(response.json()).resolves.toMatchObject({
      results: [
        { workspaceId: "ws-1", status: "done" },
        { workspaceId: "ws-2", status: "not_due" }
      ]
    });
    expect(runDailyDigest.mock.calls.map((call) => call[0])).toEqual(["ws-1"]);
  });

  it("treats a late-evening Beijing hour as due once UTC has crossed into it", async () => {
    // 15:00Z = 23:00 Beijing time, so pushHour=23 is let through at exactly this moment
    vi.setSystemTime(new Date("2026-01-06T15:00:00Z"));
    findMany.mockResolvedValue([{ workspaceId: "ws-1", pushHour: 23 }]);

    const response = await GET(request("http://localhost/api/cron/daily-digest", AUTHORIZED));

    await expect(response.json()).resolves.toMatchObject({
      results: [{ workspaceId: "ws-1", status: "done" }]
    });
  });
});

describe("concurrent runs", () => {
  it("reports a workspace whose digest another run already holds as locked", async () => {
    runDailyDigest.mockResolvedValue({ status: "locked" as const, processed: 0, remaining: 3 });

    const response = await GET(request("http://localhost/api/cron/daily-digest", AUTHORIZED));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      results: [{ workspaceId: "ws-1", status: "locked", processed: 0, remaining: 3 }]
    });
  });
});

describe("dev-only workspace filter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("narrows the run to one workspace outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await GET(request("http://localhost/api/cron/daily-digest?workspaceId=ws-9", AUTHORIZED));

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: "ws-9" } }));
  });

  it("ignores the query param in production so a caller cannot steer the cron", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await GET(request("http://localhost/api/cron/daily-digest?workspaceId=ws-9", AUTHORIZED));

    expect(findMany).toHaveBeenCalledWith(expect.not.objectContaining({ where: expect.anything() }));
  });
});
