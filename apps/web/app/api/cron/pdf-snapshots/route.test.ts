import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pruneSnapshots = vi.fn();
const getEnv = vi.fn();

vi.mock("@/lib/pdf-snapshot", () => ({ pruneSnapshots }));
vi.mock("@/lib/env", () => ({ getEnv }));

const { GET } = await import("./route");

const SECRET = "cron-secret-with-enough-length";
const call = (token = SECRET) =>
  GET(new Request("http://localhost/api/cron/pdf-snapshots", { headers: { authorization: `Bearer ${token}` } }));

beforeEach(() => {
  getEnv.mockReturnValue({ CRON_SECRET: SECRET });
  pruneSnapshots.mockResolvedValue({ listed: 3, deleted: 1, freedBytes: 2_000_000 });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("pdf snapshot cron", () => {
  it("hides the endpoint when no secret is configured", async () => {
    getEnv.mockReturnValue({ CRON_SECRET: undefined });
    expect((await call()).status).toBe(404);
    expect(pruneSnapshots).not.toHaveBeenCalled();
  });

  it("rejects a wrong token", async () => {
    expect((await call("not-the-cron-secret")).status).toBe(401);
    expect(pruneSnapshots).not.toHaveBeenCalled();
  });

  it("reports what it pruned", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, listed: 3, deleted: 1, freedBytes: 2_000_000 });
  });
});
