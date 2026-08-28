import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";

/**
 * Removing a paper archives its WorkspacePaper row instead of deleting it, so
 * annotations, comments and reading states survive. Only the library listing
 * ever honoured that state: everywhere else read "a row exists" as "it is in
 * the library", which left an archived paper claiming to be saved on Today,
 * opening as a full workspace, and silently refusing to be saved again.
 */
const password = "library-archived-e2e-password";

let workspaceId: string;
let userId: string;
let paperId: string;
let paperTitle: string;
let digestId: string;
let archivedRowId: string;
let commentBody: string;
let email: string;
let run: string;

test.beforeAll(async () => {
  run = randomUUID().slice(0, 8);
  email = `library-archived-${run}@example.com`;
  paperTitle = `Archived Library Paper ${run}`;
  commentBody = `Comment that must survive the removal ${run}`;

  const user = await prisma.user.create({
    data: {
      email,
      name: `Library Archived E2E ${run}`,
      passwordHash: await bcrypt.hash(password, 10),
      memberships: {
        create: { role: "owner", workspace: { create: { name: `Library Archived E2E ${run}` } } }
      }
    },
    include: { memberships: true }
  });
  userId = user.id;
  workspaceId = user.memberships[0]!.workspaceId;

  const paper = await prisma.paper.create({
    data: {
      title: paperTitle,
      authors: ["Archived Fixture"],
      source: "manual",
      abstract: "An archived fixture abstract for the preview page."
    }
  });
  paperId = paper.id;

  // Digest membership is what puts the paper on Today and lets it be saved
  // back; without it an archived paper would simply be a 404.
  const digest = await prisma.dailyDigest.create({
    data: {
      workspaceId,
      date: new Date(new Date().toISOString().slice(0, 10)),
      overviewSummary: `Fixture overview ${run}`,
      paperIds: [paper.id]
    }
  });
  digestId = digest.id;

  const row = await prisma.workspacePaper.create({
    data: { workspaceId, paperId, importedById: userId, tags: ["curated-tag"] }
  });
  archivedRowId = row.id;

  // Attached to the row, and the reason removal archives instead of deletes.
  await prisma.comment.create({
    data: { workspaceId, paperId, authorId: userId, body: commentBody }
  });
});

test.afterAll(async () => {
  if (digestId) await prisma.dailyDigest.delete({ where: { id: digestId } }).catch(() => undefined);
  if (paperId) await prisma.paper.delete({ where: { id: paperId } }).catch(() => undefined);
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  await prisma.$disconnect();
});

/** Each test starts from the removed state, whatever the previous one left behind. */
test.beforeEach(async () => {
  await prisma.workspacePaper.update({
    where: { id: archivedRowId },
    data: { state: "archived" }
  });
});

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("邮箱").fill(email);
  await page.getByPlaceholder("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/(today)?$/);
}

test("a removed paper offers to be saved again on Today instead of claiming to be in the library", async ({
  page
}) => {
  await signIn(page);

  await expect(page.getByText(paperTitle)).toBeVisible();
  await expect(page.getByRole("button", { name: "存入文库" })).toBeVisible();
  await expect(page.getByRole("link", { name: "在文库中显示" })).toHaveCount(0);

  // Which is the state the library was showing all along.
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: paperTitle })).toHaveCount(0);
});

test("a removed paper opens as a read-only preview, not as a workspace it was evicted from", async ({
  page
}) => {
  await signIn(page);
  await page.goto(`/papers/${paperId}`);

  await expect(page.getByText("预览模式", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "标注" })).toHaveCount(0);
  // The remove action used to be offered for a paper already removed; clicking
  // it answered 404.
  await expect(page.getByRole("button", { name: "从文库移除" })).toHaveCount(0);
});

test("saving it again revives the same row, comments and all", async ({ page }) => {
  await signIn(page);
  await page.goto(`/papers/${paperId}`);

  await page.getByRole("button", { name: "存入文库" }).click();
  await expect(page.getByRole("button", { name: "标注" })).toBeVisible();

  const revived = await prisma.workspacePaper.findUnique({
    where: { workspaceId_paperId: { workspaceId, paperId } }
  });
  expect(revived?.state).toBe("visible");
  // Same row: a second one would have orphaned everything hanging off the first.
  expect(revived?.id).toBe(archivedRowId);
  // Curated tags are the team's, not this save's, so they are left alone.
  expect(revived?.tags).toEqual(["curated-tag"]);

  const comments = await prisma.comment.findMany({ where: { workspaceId, paperId } });
  expect(comments.map((comment) => comment.body)).toContain(commentBody);

  await page.goto("/library");
  await expect(page.getByRole("heading", { name: paperTitle })).toBeVisible();
});

test("the digest column leaves reading state to the paper page", async ({ page }) => {
  await prisma.workspacePaper.update({ where: { id: archivedRowId }, data: { state: "visible" } });
  await signIn(page);

  // Saved, so the column links into the library...
  await expect(page.getByRole("link", { name: "在文库中显示" })).toBeVisible();
  // ...and stops there: four per-reader chips under every saved paper turned a
  // scan list into a form.
  await expect(page.getByTestId("reading-state-chips")).toHaveCount(0);

  // Only the digest column lost them; where the paper is actually read they
  // are still the way to mark it.
  await page.goto(`/papers/${paperId}`);
  await expect(page.getByTestId("reading-state-chips")).toHaveCount(1);
});
