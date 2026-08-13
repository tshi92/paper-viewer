import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { prisma } from "@paper-viewer/db";
import { syncConferencePapers } from "@/lib/conference-sync";

/**
 * The database side of a re-sync, which the pure unit tests cannot reach: an
 * edition that shrank upstream must lose the entries it no longer lists — and
 * only those entries, never the papers behind them — while corrected author
 * spellings must reach rows that already exist.
 *
 * No browser involved; these drive the sync function directly against the
 * local database, like the rest of the suite does with prisma.
 */
let venue: string;
let run: string;
const paperIds: string[] = [];

function feed(papers: unknown[]) {
  return { meta: { venue, year: 2026 }, papers };
}

async function entryTitles(): Promise<string[]> {
  const rows = await prisma.conferenceEntry.findMany({
    where: { venue, year: 2026 },
    select: { paper: { select: { title: true } } }
  });
  return rows.map((row) => row.paper.title).sort();
}

test.beforeAll(() => {
  run = randomUUID().slice(0, 8);
  venue = `RECON${run}`.toUpperCase();
});

test.afterEach(async () => {
  // Titles are run-scoped, so wiping the venue between tests is enough.
  const rows = await prisma.paper.findMany({
    where: { conferenceEntries: { some: { venue } } },
    select: { id: true }
  });
  for (const row of rows) {
    await prisma.paper.delete({ where: { id: row.id } }).catch(() => undefined);
  }
  paperIds.length = 0;
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("a shrunken edition drops the entries it no longer lists, keeping the papers", async () => {
  const kept = `Reconcile Kept ${run}`;
  const dropped = `Reconcile Dropped ${run}`;

  await syncConferencePapers(
    feed([
      { title: kept, authors: ["Ada Lovelace"] },
      { title: dropped, authors: ["Grace Hopper"] }
    ])
  );
  expect(await entryTitles()).toEqual([kept, dropped].sort());

  const droppedPaper = await prisma.paper.findFirst({ where: { title: dropped } });
  expect(droppedPaper).not.toBeNull();
  paperIds.push(droppedPaper!.id);

  // The upstream fix removes one article from the edition.
  const result = await syncConferencePapers(feed([{ title: kept, authors: ["Ada Lovelace"] }]));

  expect(result.unlinkedStale).toBe(1);
  expect(await entryTitles()).toEqual([kept]);

  // The article itself survives — anything annotated against it is untouched.
  expect(await prisma.paper.findUnique({ where: { id: droppedPaper!.id } })).not.toBeNull();
});

test("an edition that resolves to nothing never unlinks a whole program", async () => {
  const title = `Reconcile Guarded ${run}`;
  await syncConferencePapers(feed([{ title, authors: ["Ada Lovelace"] }]));
  expect(await entryTitles()).toEqual([title]);

  // A parse failure upstream yields an empty paper list; treating that as "the
  // edition is now empty" would wipe the whole venue-year.
  const result = await syncConferencePapers(feed([]));

  expect(result.unlinkedStale).toBe(0);
  expect(await entryTitles()).toEqual([title]);
});

test("a corrected author spelling reaches rows that already exist", async () => {
  const title = `Reconcile Authors ${run}`;

  // The state a pre-fix sync left behind: mojibake plus DBLP's homonym suffix.
  await syncConferencePapers(
    feed([{ title, authors: [{ name: "Moritz WagenlÃ¤nder" }, { name: "Li Jiang 0002" }] }])
  );
  const before = await prisma.paper.findFirst({ where: { title }, select: { id: true, authors: true } });
  expect(before!.authors).toEqual(["Moritz WagenlÃ¤nder", "Li Jiang 0002"]);

  const result = await syncConferencePapers(
    feed([
      {
        title,
        authors: [
          { name: "Moritz Wagenländer", display_name: "Moritz Wagenländer" },
          { name: "Li Jiang 0002", display_name: "Li Jiang" }
        ]
      }
    ])
  );

  expect(result.refreshedAuthors).toBe(1);
  const after = await prisma.paper.findUnique({ where: { id: before!.id }, select: { authors: true } });
  expect(after!.authors).toEqual(["Moritz Wagenländer", "Li Jiang"]);
});

test("an unchanged feed rewrites nothing", async () => {
  const title = `Reconcile Idempotent ${run}`;
  const papers = [{ title, authors: [{ name: "Ada Lovelace", display_name: "Ada Lovelace" }] }];

  await syncConferencePapers(feed(papers));
  const second = await syncConferencePapers(feed(papers));

  expect(second.createdPapers).toBe(0);
  expect(second.unlinkedStale).toBe(0);
  expect(second.refreshedAuthors).toBe(0);
  expect(await entryTitles()).toEqual([title]);
});
