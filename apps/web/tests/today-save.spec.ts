import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";

/**
 * Digest papers no longer enter the library on their own: Today lists them
 * with a save action, the paper page shows a read-only preview until someone
 * saves, and only the explicit save creates the WorkspacePaper row.
 */
const password = "today-save-e2e-password";

let workspaceId: string;
let userId: string;
let paperId: string;
let digestId: string;
let email: string;
let run: string;

test.beforeAll(async () => {
  run = randomUUID().slice(0, 8);
  email = `today-save-e2e-${run}@example.com`;

  const user = await prisma.user.create({
    data: {
      email,
      name: `Today Save E2E ${run}`,
      passwordHash: await bcrypt.hash(password, 10),
      memberships: {
        create: { role: "owner", workspace: { create: { name: `Today Save E2E ${run}` } } }
      }
    },
    include: { memberships: true }
  });
  userId = user.id;
  workspaceId = user.memberships[0]!.workspaceId;

  // A digest paper: Paper row + digest membership, deliberately NO WorkspacePaper.
  const paper = await prisma.paper.create({
    data: {
      title: `Digest Only Paper ${run}`,
      authors: ["Digest Author"],
      source: "manual",
      abstract: "A digest fixture abstract for the preview page."
    }
  });
  paperId = paper.id;

  const digest = await prisma.dailyDigest.create({
    data: {
      workspaceId,
      date: new Date(new Date().toISOString().slice(0, 10)),
      overviewSummary: `Fixture overview ${run}`,
      paperIds: [paper.id]
    }
  });
  digestId = digest.id;
});

test.afterAll(async () => {
  if (digestId) await prisma.dailyDigest.delete({ where: { id: digestId } }).catch(() => undefined);
  if (paperId) await prisma.paper.delete({ where: { id: paperId } }).catch(() => undefined);
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

/**
 * The window between the date rolling over (00:00 UTC, 08:00 Beijing) and the
 * day's run (the push hour, 13:00 by default). The page used to lose its whole
 * briefing card for those hours and show only a list of yesterday's titles.
 */
test("before the day's run, the previous briefing still leads", async ({ page }) => {
  // Backdate the fixture instead of deleting it: afterAll cleans up by id, and
  // the row has to survive this test.
  const today = new Date(new Date().toISOString().slice(0, 10));
  const yesterday = new Date(Date.now() - 86_400_000);
  await prisma.dailyDigest.update({
    where: { id: digestId },
    data: { date: new Date(yesterday.toISOString().slice(0, 10)) }
  });
  try {
    await signIn(page);

    // The briefing is on the page in full, not buried in a disclosure.
    await expect(page.getByText(`Fixture overview ${run}`)).toBeVisible();
    // And headed by its own date, which is what says this is the previous
    // edition rather than today's. (An eyebrow used to say it in words, above
    // the date that already did.)
    const zhDate = new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long"
    });
    // The card renders the digest's date column, which is UTC midnight — so the
    // expectation is built from the same UTC day the fixture was stored under.
    const asRendered = (value: Date) => zhDate.format(new Date(value.toISOString().slice(0, 10)));
    await expect(page.getByRole("heading", { name: asRendered(yesterday) })).toBeVisible();
    await expect(page.getByRole("heading", { name: asRendered(new Date()) })).toHaveCount(0);
    // And its papers keep the full treatment, save action included.
    await expect(page.getByText(`Digest Only Paper ${run}`)).toBeVisible();
  } finally {
    await prisma.dailyDigest.update({ where: { id: digestId }, data: { date: today } });
  }
});

test("past days are collapsed to a title list and expand on demand", async ({ page }) => {
  // A one-paper digest dated yesterday: it must render as a closed disclosure
  // row, not as full cards like today's digest.
  const pastPaper = await prisma.paper.create({
    data: { title: `Past Digest Paper ${run}`, authors: ["Past Author"], source: "manual" }
  });
  const pastDigest = await prisma.dailyDigest.create({
    data: {
      workspaceId,
      date: new Date(new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)),
      overviewSummary: "",
      paperIds: [pastPaper.id]
    }
  });
  try {
    await signIn(page);

    const pastRow = page.locator("summary", { hasText: "1 篇论文" });
    await expect(pastRow).toBeVisible();
    await expect(page.getByText(`Past Digest Paper ${run}`)).toBeHidden();

    await pastRow.click();
    await expect(page.getByText(`Past Digest Paper ${run}`)).toBeVisible();
    // The expanded row still offers the save action.
    await expect(
      page.locator("details").getByRole("button", { name: "存入文库" })
    ).toBeVisible();
  } finally {
    await prisma.dailyDigest.delete({ where: { id: pastDigest.id } }).catch(() => undefined);
    await prisma.paper.delete({ where: { id: pastPaper.id } }).catch(() => undefined);
  }
});

test("a digest paper stays out of the library until it is saved", async ({ page }) => {
  await signIn(page);

  // Today lists it with a save action.
  await expect(page.getByText(`Digest Only Paper ${run}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "存入文库" })).toBeVisible();

  // The library does not know it yet.
  await page.goto("/library");
  await expect(page.getByText(`Digest Only Paper ${run}`)).toHaveCount(0);

  expect(
    await prisma.workspacePaper.findUnique({
      where: { workspaceId_paperId: { workspaceId, paperId } }
    })
  ).toBeNull();
});

test("the paper page is a read-only preview and saving unlocks the workspace", async ({ page }) => {
  await signIn(page);
  await page.goto(`/papers/${paperId}`);

  // Preview mode: notice + save action, none of the workspace tabs.
  await expect(page.getByText("预览模式", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "标注" })).toHaveCount(0);

  await page.getByRole("button", { name: "存入文库" }).click();

  // The refresh swaps the preview for the full workspace.
  await expect(page.getByRole("button", { name: "标注" })).toBeVisible();
  await expect(page.getByText("预览模式", { exact: false })).toHaveCount(0);

  const saved = await prisma.workspacePaper.findUnique({
    where: { workspaceId_paperId: { workspaceId, paperId } }
  });
  expect(saved).not.toBeNull();
  expect(saved!.importedById).toBe(userId);

  // Now the library lists it, and Today shows it as saved.
  await page.goto("/library");
  await expect(page.getByText(`Digest Only Paper ${run}`)).toBeVisible();
  await page.goto("/today");
  await expect(page.getByRole("link", { name: "在文库中显示" })).toBeVisible();
});

test("papers outside the workspace's digests cannot be previewed or saved", async ({ page }) => {
  const foreign = await prisma.paper.create({
    data: { title: `Foreign Paper ${run}`, authors: [], source: "manual" }
  });
  try {
    await signIn(page);

    const save = await page.request.post(`/api/papers/${foreign.id}/save`);
    expect(save.status()).toBe(404);

    const response = await page.goto(`/papers/${foreign.id}`);
    expect(response?.status()).toBe(404);
  } finally {
    await prisma.paper.delete({ where: { id: foreign.id } }).catch(() => undefined);
  }
});
