import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireCurrentUser = vi.fn();
const runDailyDigest = vi.fn();

vi.mock("@/lib/auth", () => ({ requireCurrentUser }));
vi.mock("@/lib/daily-digest", () => ({ runDailyDigest }));

const { POST } = await import("./route");

beforeEach(() => {
  requireCurrentUser.mockResolvedValue({ workspaceId: "ws-1" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("discover auth", () => {
  it("rejects anonymous callers without touching the pipeline", async () => {
    requireCurrentUser.mockRejectedValue(new Error("no session"));

    const response = await POST();

    expect(response.status).toBe(401);
    expect(runDailyDigest).not.toHaveBeenCalled();
  });
});

describe("discover status mapping", () => {
  it("reports progress for a finished or partial run", async () => {
    runDailyDigest.mockResolvedValue({ status: "done", processed: 3, remaining: 0 });
    await expect((await POST()).json()).resolves.toMatchObject({
      ok: true,
      status: "done",
      discovered: 3,
      remaining: 0
    });

    runDailyDigest.mockResolvedValue({ status: "partial", processed: 1, remaining: 2 });
    await expect((await POST()).json()).resolves.toMatchObject({
      ok: true,
      status: "partial",
      discovered: 1,
      remaining: 2
    });
  });

  it("treats a locked digest as 'someone else is already running it', not an error", async () => {
    runDailyDigest.mockResolvedValue({ status: "locked", processed: 0, remaining: 2 });

    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, running: true });
  });

  it("keeps the skipped statuses successful", async () => {
    runDailyDigest.mockResolvedValue({ status: "skipped_no_new", processed: 0, remaining: 0 });
    await expect((await POST()).json()).resolves.toMatchObject({ ok: true, discovered: 0 });

    runDailyDigest.mockResolvedValue({ status: "skipped_done", processed: 0, remaining: 0 });
    await expect((await POST()).json()).resolves.toMatchObject({ ok: true, alreadyDone: true });
  });

  it("surfaces the pipeline message on error", async () => {
    runDailyDigest.mockResolvedValue({
      status: "error",
      processed: 0,
      remaining: 0,
      message: "尚未配置研究偏好"
    });

    const response = await POST();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: "尚未配置研究偏好" });
  });
});
