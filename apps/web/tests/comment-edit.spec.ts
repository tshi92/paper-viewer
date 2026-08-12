import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";

/**
 * Editing and deleting comments is author-only, and the workspace owner — the
 * strongest role there is — stands in for "not even an admin may touch someone
 * else's comment".
 */
const password = "comment-edit-e2e-password";

let workspaceId: string;
let ownerId: string;
let memberId: string;
let paperId: string;
let ownerEmail: string;
let memberEmail: string;
let ownComment: string;
let otherComment: string;
let parentWithReplies: string;
let replyIds: string[] = [];

test.beforeAll(async () => {
  const run = randomUUID().slice(0, 8);
  ownerEmail = `comment-edit-owner-${run}@example.com`;
  memberEmail = `comment-edit-member-${run}@example.com`;

  const owner = await prisma.user.create({
    data: {
      email: ownerEmail,
      name: `Comment Edit Owner ${run}`,
      passwordHash: await bcrypt.hash(password, 10),
      memberships: {
        create: { role: "owner", workspace: { create: { name: `Comment Edit E2E ${run}` } } }
      }
    },
    include: { memberships: true }
  });
  ownerId = owner.id;
  workspaceId = owner.memberships[0]!.workspaceId;

  const member = await prisma.user.create({
    data: {
      email: memberEmail,
      name: `Comment Edit Member ${run}`,
      passwordHash: await bcrypt.hash(password, 10),
      memberships: { create: { role: "member", workspaceId } }
    }
  });
  memberId = member.id;

  const paper = await prisma.paper.create({
    data: {
      title: `Comment Edit Fixture Paper ${run}`,
      authors: ["E2E Author"],
      source: "manual",
      abstract: "A fixture abstract.",
      workspacePapers: { create: { workspaceId, importedById: ownerId } }
    }
  });
  paperId = paper.id;

  ownComment = (
    await prisma.comment.create({
      data: { workspaceId, paperId, authorId: ownerId, body: "owner original body" }
    })
  ).id;
  otherComment = (
    await prisma.comment.create({
      data: { workspaceId, paperId, authorId: memberId, body: "member only comment" }
    })
  ).id;

  const parent = await prisma.comment.create({
    data: {
      workspaceId,
      paperId,
      authorId: ownerId,
      body: "owner parent with replies",
      replies: {
        create: [
          { workspaceId, paperId, authorId: memberId, body: "reply one" },
          { workspaceId, paperId, authorId: ownerId, body: "reply two" }
        ]
      }
    },
    include: { replies: true }
  });
  parentWithReplies = parent.id;
  replyIds = parent.replies.map((reply) => reply.id);
});

test.afterAll(async () => {
  if (paperId) await prisma.paper.delete({ where: { id: paperId } }).catch(() => undefined);
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
  for (const id of [ownerId, memberId]) {
    if (id) await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("邮箱").fill(email);
  await page.getByPlaceholder("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/(today)?$/);
}

test("the author edits a discussion comment; other people's carry no affordances", async ({ page }) => {
  await signIn(page, ownerEmail);
  await page.goto(`/papers/${paperId}`);
  await page.getByRole("button", { name: /^评论（/ }).click();

  const mine = page.locator("article", { hasText: "owner original body" });
  await mine.getByRole("button", { name: "编辑" }).click();

  // Once it swaps into an editor the article no longer contains the old text.
  const editing = page.locator("article").filter({ has: page.locator("textarea") });
  await editing.locator("textarea").fill("owner edited body");
  await editing.getByRole("button", { name: "保存" }).click();

  // The editor closes only after the PATCH resolved.
  await expect(editing).toHaveCount(0);
  await expect(page.getByText("owner edited body")).toBeVisible();
  expect((await prisma.comment.findUniqueOrThrow({ where: { id: ownComment } })).body).toBe(
    "owner edited body"
  );

  const theirs = page.locator("article", { hasText: "member only comment" });
  await expect(theirs).toBeVisible();
  await expect(theirs.getByRole("button", { name: "编辑" })).toHaveCount(0);
  await expect(theirs.getByRole("button", { name: "删除" })).toHaveCount(0);
});

test("the workspace owner may not edit or delete someone else's comment", async ({ page }) => {
  await signIn(page, ownerEmail);

  const patch = await page.request.patch(`/api/papers/${paperId}/comments/${otherComment}`, {
    data: { body: "hijacked" }
  });
  expect(patch.status()).toBe(403);

  const del = await page.request.delete(`/api/papers/${paperId}/comments/${otherComment}`);
  expect(del.status()).toBe(403);

  expect((await prisma.comment.findUniqueOrThrow({ where: { id: otherComment } })).body).toBe(
    "member only comment"
  );
});

test("deleting a comment warns about its replies and takes the thread with it", async ({ page }) => {
  await signIn(page, ownerEmail);
  await page.goto(`/papers/${paperId}`);
  await page.getByRole("button", { name: /^评论（/ }).click();

  await page
    .locator("article", { hasText: "owner parent with replies" })
    .getByRole("button", { name: "删除" })
    .click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("2");
  await expect(dialog).toContainText("回复");
  await dialog.getByRole("button", { name: "删除" }).click();

  await expect(page.getByText("owner parent with replies")).toHaveCount(0);

  const remaining = await prisma.comment.findMany({
    where: { id: { in: [parentWithReplies, ...replyIds] } }
  });
  expect(remaining).toHaveLength(0);
});

test("annotation threads offer the same author-only edit and delete", async ({ page }) => {
  const annotation = await prisma.annotation.create({
    data: {
      workspaceId,
      paperId,
      authorId: ownerId,
      type: "highlight",
      pageNumber: 1,
      position: {},
      quotedText: "a quoted sentence",
      comments: {
        create: [
          { workspaceId, paperId, authorId: ownerId, body: "thread comment by owner" },
          { workspaceId, paperId, authorId: memberId, body: "thread comment by member" }
        ]
      }
    },
    include: { comments: true }
  });
  const mineId = annotation.comments.find((comment) => comment.authorId === ownerId)!.id;

  await signIn(page, ownerEmail);
  await page.goto(`/papers/${paperId}`);
  // 简介 opens by default now; the annotation threads live in the 标注 tab.
  await page.getByRole("button", { name: "标注" }).click();

  const thread = page.locator("article", { hasText: "thread comment by owner" });
  await expect(thread).toBeVisible();
  // Two comments in the thread, one of them the caller's: exactly one edit button.
  await expect(thread.getByRole("button", { name: "编辑" })).toHaveCount(1);

  await thread.getByRole("button", { name: "编辑" }).click();
  await page.locator("article textarea").fill("thread comment edited");
  await page.getByRole("article").getByRole("button", { name: "保存" }).click();
  await expect(page.locator("article textarea")).toHaveCount(0);
  expect((await prisma.comment.findUniqueOrThrow({ where: { id: mineId } })).body).toBe(
    "thread comment edited"
  );

  await page
    .locator("article", { hasText: "thread comment edited" })
    .getByRole("button", { name: "删除" })
    .first()
    .click();
  await page.getByRole("alertdialog").getByRole("button", { name: "删除" }).click();
  await expect(page.getByText("thread comment edited")).toHaveCount(0);
  expect(await prisma.comment.findUnique({ where: { id: mineId } })).toBeNull();

  await prisma.annotation.delete({ where: { id: annotation.id } });
});

test("an unknown comment id reads as missing rather than forbidden", async ({ page }) => {
  await signIn(page, memberEmail);
  const missing = await page.request.patch(`/api/papers/${paperId}/comments/does-not-exist`, {
    data: { body: "x" }
  });
  expect(missing.status()).toBe(404);
});
