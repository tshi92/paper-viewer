import { describe, expect, it, vi } from "vitest";

const ensurePdfSnapshot = vi.fn();
const scheduled: (() => Promise<void>)[] = [];

vi.mock("next/server", () => ({ after: (task: () => Promise<void>) => scheduled.push(task) }));
vi.mock("@/lib/auth", () => ({ requireCurrentUser: async () => ({ id: "u-1", workspaceId: "ws-1" }) }));
vi.mock("@/lib/paper-access", () => ({ canAccessPaper: async () => true }));
vi.mock("@/lib/library-dedup", () => ({ findLibraryDuplicate: async () => null }));
vi.mock("@/lib/pdf-snapshot", () => ({ ensurePdfSnapshot }));
vi.mock("@/lib/daily-digest", () => ({
  analysisTags: async () => [],
  analyzePaperOnDemand: vi.fn(),
  isUniqueViolation: () => false
}));
vi.mock("@paper-viewer/db", () => ({
  prisma: {
    workspacePaper: { findUnique: async () => null, create: async () => ({}) },
    paper: { findUnique: async () => ({ title: "A paper", doi: null, arxivId: "2610.00001" }) },
    paperAnalysis: { findFirst: async () => ({ id: "analysis" }) }
  }
}));

const { POST } = await import("./route");

describe("saving a paper", () => {
  it("pins its PDF once the response is out, so its first open needs no live copy", async () => {
    const response = await POST(new Request("http://localhost/api/papers/p-1/save", { method: "POST" }), {
      params: Promise.resolve({ paperId: "p-1" })
    });

    await expect(response.json()).resolves.toEqual({ saved: true });
    expect(ensurePdfSnapshot).not.toHaveBeenCalled();

    await Promise.all(scheduled.map((task) => task()));
    expect(ensurePdfSnapshot).toHaveBeenCalledWith("p-1", "ws-1");
  });
});
