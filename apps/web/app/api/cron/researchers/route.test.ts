import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const runResearchers = vi.fn();
const getEnv = vi.fn();

vi.mock("@paper-viewer/db", () => ({ prisma: { workspace: { findMany } } }));
vi.mock("@/lib/researcher-run", () => ({ runResearchers }));
vi.mock("@/lib/env", () => ({ getEnv }));

const { GET } = await import("./route");

const SECRET = "cron-secret-with-enough-length";
const call = (token = SECRET) =>
  GET(new Request("http://localhost/api/cron/researchers", { headers: { authorization: `Bearer ${token}` } }));

beforeEach(() => {
  getEnv.mockReturnValue({ CRON_SECRET: SECRET });
  findMany.mockResolvedValue([{ id: "ws-a" }, { id: "ws-b" }]);
  runResearchers.mockResolvedValue({ ranAt: "2026-09-28T00:00:00.000Z", sync: { linked: 0 }, workspaces: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("researchers cron", () => {
  it("hides the endpoint when no secret is configured", async () => {
    getEnv.mockReturnValue({ CRON_SECRET: undefined });
    expect((await call()).status).toBe(404);
    expect(runResearchers).not.toHaveBeenCalled();
  });

  it("rejects a wrong token", async () => {
    expect((await call("not-the-cron-secret")).status).toBe(401);
    expect(runResearchers).not.toHaveBeenCalled();
  });

  it("runs every workspace in one run", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(runResearchers).toHaveBeenCalledTimes(1);
    expect(runResearchers).toHaveBeenCalledWith(["ws-a", "ws-b"]);
    await expect(response.json()).resolves.toMatchObject({ ok: true, sync: { linked: 0 } });
  });
});
