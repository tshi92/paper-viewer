import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireCurrentUser = vi.fn();
const runResearchers = vi.fn();

vi.mock("@/lib/auth", () => ({ requireCurrentUser }));
vi.mock("@/lib/researcher-run", () => ({ runResearchers }));

const { POST } = await import("./route");

beforeEach(() => {
  requireCurrentUser.mockResolvedValue({ workspaceId: "ws-1", role: "admin" });
  runResearchers.mockResolvedValue({ ranAt: "2026-09-29T08:00:00.000Z", sync: { linked: 2 }, workspaces: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("researchers sync", () => {
  it("rejects anonymous callers", async () => {
    requireCurrentUser.mockRejectedValue(new Error("no session"));
    expect((await POST()).status).toBe(401);
    expect(runResearchers).not.toHaveBeenCalled();
  });

  it("rejects members, who cannot manage the workspace", async () => {
    requireCurrentUser.mockResolvedValue({ workspaceId: "ws-1", role: "member" });
    expect((await POST()).status).toBe(403);
    expect(runResearchers).not.toHaveBeenCalled();
  });

  it("runs only the caller's workspace", async () => {
    const response = await POST();
    expect(response.status).toBe(200);
    expect(runResearchers).toHaveBeenCalledWith(["ws-1"]);
    await expect(response.json()).resolves.toMatchObject({ ok: true, sync: { linked: 2 } });
  });
});
