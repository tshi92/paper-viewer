import { describe, expect, it } from "vitest";
import { annotationInvolvesUser, filterThreadsByParticipant, readViewMode } from "./view-mode";

function comment(id: string, authorId: string, parentId: string | null = null) {
  return { id, parentId, author: { id: authorId } };
}

describe("readViewMode", () => {
  it("defaults to the team view for absent or unknown values", () => {
    expect(readViewMode(undefined)).toBe("team");
    expect(readViewMode("gibberish")).toBe("team");
  });

  it("reads mine back", () => {
    expect(readViewMode("mine")).toBe("mine");
  });
});

describe("filterThreadsByParticipant", () => {
  it("keeps a whole thread when the user wrote any message in it", () => {
    // A colleague's question with my reply: both stay — my reply alone would
    // have no context, and their question alone would hide my answer.
    const thread = [comment("root", "colleague"), comment("reply", "me", "root")];

    expect(filterThreadsByParticipant(thread, "me")).toEqual(thread);
  });

  it("drops a thread the user never touched", () => {
    const theirs = [comment("root", "a"), comment("reply", "b", "root")];

    expect(filterThreadsByParticipant(theirs, "me")).toEqual([]);
  });

  it("judges each thread separately", () => {
    const mineRoot = comment("m1", "me");
    const theirReply = comment("m2", "colleague", "m1");
    const theirsOnly = comment("t1", "colleague");

    expect(filterThreadsByParticipant([mineRoot, theirReply, theirsOnly], "me")).toEqual([
      mineRoot,
      theirReply
    ]);
  });

  it("follows reply chains to the root, not just one level", () => {
    const chain = [
      comment("root", "a"),
      comment("mid", "b", "root"),
      comment("deep", "me", "mid")
    ];

    expect(filterThreadsByParticipant(chain, "me")).toEqual(chain);
  });

  it("treats replies stranded by a deleted parent as one thread from the break", () => {
    const strandedMine = comment("s1", "me", "gone");
    const strandedSibling = comment("s2", "colleague", "s1");
    const strandedTheirs = comment("t1", "colleague", "gone-too");

    expect(
      filterThreadsByParticipant([strandedMine, strandedSibling, strandedTheirs], "me")
    ).toEqual([strandedMine, strandedSibling]);
  });
});

describe("annotationInvolvesUser", () => {
  it("keeps my annotations and ones I commented on, drops the rest", () => {
    const mine = { author: { id: "me" }, comments: [] };
    const discussed = { author: { id: "a" }, comments: [comment("c", "me")] };
    const theirs = { author: { id: "a" }, comments: [comment("c", "b")] };

    expect(annotationInvolvesUser(mine, "me")).toBe(true);
    expect(annotationInvolvesUser(discussed, "me")).toBe(true);
    expect(annotationInvolvesUser(theirs, "me")).toBe(false);
  });
});
