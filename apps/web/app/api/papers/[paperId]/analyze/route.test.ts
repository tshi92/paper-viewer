import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireCurrentUser = vi.fn();
const analyzePaperOnDemand = vi.fn();
const findUniqueWorkspacePaper = vi.fn();
const findFirstAnalysis = vi.fn();

vi.mock("@/lib/auth", () => ({ requireCurrentUser }));
vi.mock("@/lib/daily-digest", () => ({ analyzePaperOnDemand }));
vi.mock("@paper-viewer/db", () => ({
  prisma: {
    workspacePaper: { findUnique: findUniqueWorkspacePaper },
    paperAnalysis: { findFirst: findFirstAnalysis }
  }
}));

const { POST } = await import("./route");

function request(body: unknown = {}) {
  return new Request("http://localhost/api/papers/p-1/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

const params = Promise.resolve({ paperId: "p-1" });

beforeEach(() => {
  requireCurrentUser.mockResolvedValue({ workspaceId: "ws-1" });
  findUniqueWorkspacePaper.mockResolvedValue({ workspaceId: "ws-1", paperId: "p-1" });
  findFirstAnalysis.mockResolvedValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

/**
 * A failed generation used to reach the reader as "please try again", with the
 * cause left in a platform log they cannot open — so a rate limit, a model that
 * ran long and a rejected request were indistinguishable, and only one of them
 * is worth trying again.
 */
describe("a failed analysis says what failed", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("passes the provider's own complaint through", async () => {
    analyzePaperOnDemand.mockRejectedValue(
      new Error("LLM API error 429: rate limit exceeded for this organization")
    );

    const response = await POST(request(), { params });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "LLM API error 429: rate limit exceeded for this organization"
    });
  });

  it("names a model that ran long, rather than the abort that stopped it", async () => {
    // What `AbortSignal.timeout` throws; its message is "signal timed out",
    // which tells the reader nothing about what was being waited on.
    const timeout = new Error("signal timed out");
    timeout.name = "TimeoutError";
    analyzePaperOnDemand.mockRejectedValue(timeout);

    const response = await POST(request(), { params });

    await expect(response.json()).resolves.toEqual({
      error: "the model did not answer in time"
    });
  });

  it("caps a runaway provider body, which is going into a toast", async () => {
    analyzePaperOnDemand.mockRejectedValue(new Error("x".repeat(5_000)));

    const response = await POST(request(), { params });
    const body = (await response.json()) as { error: string };

    expect(body.error).toHaveLength(200);
  });

  it("still reports a rejection that is not an Error at all", async () => {
    analyzePaperOnDemand.mockRejectedValue("upstream exploded");

    const response = await POST(request(), { params });

    await expect(response.json()).resolves.toEqual({ error: "upstream exploded" });
  });
});

describe("a successful analysis is unchanged", () => {
  it("reports whether anything was written", async () => {
    analyzePaperOnDemand.mockResolvedValue(true);

    const response = await POST(request(), { params });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, generated: true });
  });

  it("yields to an analysis that already exists", async () => {
    findFirstAnalysis.mockResolvedValue({ id: "a-1" });

    const response = await POST(request(), { params });

    await expect(response.json()).resolves.toEqual({ ok: true, existing: true });
    expect(analyzePaperOnDemand).not.toHaveBeenCalled();
  });
});
