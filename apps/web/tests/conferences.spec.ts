import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";

/**
 * The conference catalog: entries are shared read-only content, papers open
 * as previews, saving is explicit, and an article already in the library
 * under another Paper row is never added twice.
 */
const password = "conferences-e2e-password";

let workspaceId: string;
let userId: string;
let email: string;
let run: string;
let venueA: string;
let venueB: string;
let paperAId: string;
let paperDupId: string;
let libraryTwinId: string;

test.beforeAll(async () => {
  run = randomUUID().slice(0, 8);
  email = `conferences-e2e-${run}@example.com`;
  venueA = `SOSPA${run}`.toUpperCase();
  venueB = `OSDIB${run}`.toUpperCase();

  const user = await prisma.user.create({
    data: {
      email,
      name: `Conferences E2E ${run}`,
      passwordHash: await bcrypt.hash(password, 10),
      memberships: {
        create: { role: "owner", workspace: { create: { name: `Conferences E2E ${run}` } } }
      }
    },
    include: { memberships: true }
  });
  userId = user.id;
  workspaceId = user.memberships[0]!.workspaceId;

  // Venue A: a plain conference paper, not in any library.
  const paperA = await prisma.paper.create({
    data: {
      title: `Conference Fixture Alpha ${run}`,
      authors: ["Alpha Author"],
      source: "conference",
      sourceId: `${venueA.toLowerCase()}-2025-alpha-${run}`,
      abstract: "A systems paper used by the conferences E2E fixture."
    }
  });
  paperAId = paperA.id;
  await prisma.conferenceEntry.create({ data: { venue: venueA, year: 2025, paperId: paperA.id } });

  // Venue B: a conference paper whose title matches a paper that is already
  // in the library as a DIFFERENT Paper row (duplicate-article scenario).
  const twin = await prisma.paper.create({
    data: {
      title: `Conference Fixture Twin ${run}`,
      authors: ["Twin Author"],
      source: "manual"
    }
  });
  libraryTwinId = twin.id;
  await prisma.workspacePaper.create({
    data: { workspaceId, paperId: twin.id, importedById: userId }
  });
  const paperDup = await prisma.paper.create({
    data: {
      // Case/punctuation differ on purpose: the check normalizes titles.
      title: `conference fixture TWIN ${run}!`,
      authors: ["Twin Author"],
      source: "conference",
      sourceId: `${venueB.toLowerCase()}-2024-twin-${run}`
    }
  });
  paperDupId = paperDup.id;
  await prisma.conferenceEntry.create({ data: { venue: venueB, year: 2024, paperId: paperDup.id } });
});

test.afterAll(async () => {
  // ConferenceEntry rows cascade with their papers.
  for (const id of [paperAId, paperDupId, libraryTwinId]) {
    if (id) await prisma.paper.delete({ where: { id } }).catch(() => undefined);
  }
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  await prisma.$disconnect();
});

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("邮箱").fill(email);
  await page.getByPlaceholder("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/(today)?$/);
}

test("catalog lists entries by venue, previews before save, saves into the library", async ({ page }) => {
  await signIn(page);
  // The unfiltered catalog holds thousands of real entries and caps the page,
  // so every fixture assertion goes through its own venue filter.
  await page.goto(`/conferences?venue=${venueA}`);

  // The count line names the selected program.
  await expect(page.getByText(`${venueA} 2025 ·`)).toBeVisible();
  const sectionA = page.locator("section", { has: page.getByText(`Conference Fixture Alpha ${run}`) });
  await expect(sectionA.getByRole("button", { name: "存入文库" })).toBeVisible();

  // Unsaved: the paper page is a read-only preview.
  await page.goto(`/papers/${paperAId}`);
  await expect(page.getByText("预览模式", { exact: false })).toBeVisible();

  // Save from the catalog card.
  await page.goto(`/conferences?venue=${venueA}`);
  await sectionA.getByRole("button", { name: "存入文库" }).click();
  await expect(sectionA.getByText("已在文库")).toBeVisible();

  await page.goto("/library");
  await expect(page.getByText(`Conference Fixture Alpha ${run}`)).toBeVisible();

  const saved = await prisma.workspacePaper.findUnique({
    where: { workspaceId_paperId: { workspaceId, paperId: paperAId } }
  });
  expect(saved?.importedById).toBe(userId);
});

test("saving a title twin of a library paper is refused with a pointer to the existing entry", async ({ page }) => {
  await signIn(page);
  await page.goto(`/conferences?venue=${venueB}`);

  const sectionB = page.locator("section", { has: page.getByText(`conference fixture TWIN ${run}!`) });
  await sectionB.getByRole("button", { name: "存入文库" }).click();

  await expect(sectionB.getByText("该论文已在文库中")).toBeVisible();
  const viewLink = sectionB.getByRole("link", { name: "查看" });
  await expect(viewLink).toHaveAttribute("href", `/papers/${libraryTwinId}`);

  expect(
    await prisma.workspacePaper.findUnique({
      where: { workspaceId_paperId: { workspaceId, paperId: paperDupId } }
    })
  ).toBeNull();
});

test("venue chips and search surface a program from the whole catalog", async ({ page }) => {
  await signIn(page);
  await page.goto("/conferences");

  // The chip rail lists every program; picking one shows exactly its papers.
  await page.getByRole("link", { name: new RegExp(`${venueA} ·`) }).click();
  await expect(page).toHaveURL(new RegExp(`venue=${venueA}`));
  await expect(page.getByText(`Conference Fixture Alpha ${run}`)).toBeVisible();
  await expect(page.getByText(`conference fixture TWIN ${run}!`)).toHaveCount(0);

  // Search spans all venues and years regardless of the chip selection.
  await page.getByLabel("搜索标题或作者…").fill(`Conference Fixture Twin ${run}`);
  await expect(page.getByText(`conference fixture TWIN ${run}!`)).toBeVisible();
  await expect(page.getByText(`${venueB} 2024`, { exact: false })).toBeVisible();
});

test("sync endpoint is admin-gated", async ({ page }) => {
  // A plain member must not be able to trigger a catalog import.
  const memberEmail = `conferences-e2e-member-${run}@example.com`;
  const member = await prisma.user.create({
    data: {
      email: memberEmail,
      name: `Conferences E2E Member ${run}`,
      passwordHash: await bcrypt.hash(password, 10),
      memberships: { create: { role: "member", workspaceId } }
    }
  });
  try {
    await page.goto("/login");
    await page.getByPlaceholder("邮箱").fill(memberEmail);
    await page.getByPlaceholder("密码").fill(password);
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page).toHaveURL(/\/(today)?$/);

    const response = await page.request.post("/api/conferences/sync");
    expect(response.status()).toBe(403);
  } finally {
    await prisma.user.delete({ where: { id: member.id } }).catch(() => undefined);
  }
});
