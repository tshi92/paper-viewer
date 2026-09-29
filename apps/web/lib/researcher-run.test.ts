import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const syncResearchers = vi.fn();
const classifyPendingPapers = vi.fn();
const ensureMonthlyIssue = vi.fn();

vi.mock("@/lib/researcher-sync", () => ({ syncResearchers, classifyPendingPapers }));
vi.mock("@/lib/researcher-digest", () => ({ ensureMonthlyIssue }));

const { runResearchers } = await import("./researcher-run");

const workspaceIdsOf = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls.map((call) => call[0]);

beforeEach(() => {
  syncResearchers.mockResolvedValue({ linked: 0 });
  classifyPendingPapers.mockResolvedValue({ classified: 0, remaining: 0 });
  ensureMonthlyIssue.mockResolvedValue({ status: "exists" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("runResearchers", () => {
  it("syncs once, then classifies and checks the issue of each workspace under its own id", async () => {
    const run = await runResearchers(["ws-a", "ws-b"]);
    expect(syncResearchers).toHaveBeenCalledTimes(1);
    expect(workspaceIdsOf(classifyPendingPapers)).toEqual(["ws-a", "ws-b"]);
    expect(workspaceIdsOf(ensureMonthlyIssue)).toEqual(["ws-a", "ws-b"]);
    expect(run.workspaces.map((w) => [w.workspaceId, w.issue.status])).toEqual([["ws-a", "exists"], ["ws-b", "exists"]]);
  });

  it("still refreshes from stored data when the sync fails", async () => {
    syncResearchers.mockRejectedValue(new Error("Fetch failed (503)"));
    const run = await runResearchers(["ws-a"]);
    expect(run.sync).toEqual({ error: "Fetch failed (503)" });
    expect(workspaceIdsOf(ensureMonthlyIssue)).toEqual(["ws-a"]);
  });

  it("seals no issue over papers still waiting for a direction in that workspace", async () => {
    classifyPendingPapers.mockImplementation(async (workspaceId: string) =>
      workspaceId === "ws-a" ? { classified: 20, remaining: 5 } : { classified: 0, remaining: 0 }
    );
    const run = await runResearchers(["ws-a", "ws-b"]);
    expect(workspaceIdsOf(ensureMonthlyIssue)).toEqual(["ws-b"]);
    expect(run.workspaces[0]!.issue).toEqual({ status: "deferred" });
  });

  it("records a workspace whose classification failed and goes on to the next", async () => {
    classifyPendingPapers.mockImplementation(async (workspaceId: string) => {
      if (workspaceId === "ws-a") throw new Error("LLM API error 401");
      return { classified: 0, remaining: 0 };
    });
    const run = await runResearchers(["ws-a", "ws-b"]);
    expect(run.workspaces[0]).toEqual({ workspaceId: "ws-a", issue: { status: "error", message: "LLM API error 401" } });
    expect(workspaceIdsOf(ensureMonthlyIssue)).toEqual(["ws-b"]);
  });
});
