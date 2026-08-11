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

function prefsOf(...workspaceIds: string[]) {
  return workspaceIds.map((workspaceId) => ({ workspaceId }));
}

function ok(processed: number) {
  return { status: "done" as const, processed, remaining: 0 };
}

beforeEach(() => {
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
    vi.useFakeTimers();
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
