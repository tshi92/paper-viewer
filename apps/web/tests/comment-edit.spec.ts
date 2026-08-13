import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";

/**
 * Comment moderation: authors manage their own, and admins/owners may edit or
 * delete anyone's. A plain member touching someone else's is still refused.
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

/**
 * Copy/edit/delete live behind each row's ⋮ menu. `scope` is the row (an
 * article, or a locator narrowed to one comment); `index` picks which menu
 * inside it when a thread carries several.
 */
async function openRowMenu(scope: Locator, index = 0): Promise<Locator> {
  await scope.getByRole("button", { name: "更多操作" }).nth(index).click();
  // Only one menu is open at a time, so the open panel is unambiguous.
  return scope.getByRole("menu");
}

test("the author edits their own comment; the owner also sees moderation affordances", async ({ page }) => {
  await signIn(page, ownerEmail);
  await page.goto(`/papers/${paperId}`);
  await page.getByRole("button", { name: "评论", exact: true }).click();

  const mine = page.locator("article", { hasText: "owner original body" });
  await (await openRowMenu(mine)).getByRole("menuitem", { name: "编辑" }).click();

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

  // The owner moderates: someone else's comment carries the affordances too.
  const theirs = page.locator("article", { hasText: "member only comment" });
  await expect(theirs).toBeVisible();
  const theirsMenu = await openRowMenu(theirs);
  await expect(theirsMenu.getByRole("menuitem", { name: "编辑" })).toHaveCount(1);
  await expect(theirsMenu.getByRole("menuitem", { name: "删除" })).toHaveCount(1);
});

test("admins moderate anyone's comment; a plain member is refused", async ({ page }) => {
  await signIn(page, ownerEmail);

  const patch = await page.request.patch(`/api/papers/${paperId}/comments/${otherComment}`, {
    data: { body: "moderated by owner" }
  });
  expect(patch.status()).toBe(200);
  expect((await prisma.comment.findUniqueOrThrow({ where: { id: otherComment } })).body).toBe(
    "moderated by owner"
  );

  // The member may not touch the owner's comment.
  await signIn(page, memberEmail);
  const memberPatch = await page.request.patch(`/api/papers/${paperId}/comments/${ownComment}`, {
    data: { body: "hijacked" }
  });
  expect(memberPatch.status()).toBe(403);
  const memberDelete = await page.request.delete(`/api/papers/${paperId}/comments/${ownComment}`);
  expect(memberDelete.status()).toBe(403);

  // Back as owner: moderation extends to deletion.
  await signIn(page, ownerEmail);
  const del = await page.request.delete(`/api/papers/${paperId}/comments/${otherComment}`);
  expect(del.status()).toBe(200);
  expect(await prisma.comment.findUnique({ where: { id: otherComment } })).toBeNull();
});

test("deleting a comment warns about its replies and takes the thread with it", async ({ page }) => {
  await signIn(page, ownerEmail);
  await page.goto(`/papers/${paperId}`);
  await page.getByRole("button", { name: "评论", exact: true }).click();

  const parent = page.locator("article", { hasText: "owner parent with replies" });
  await (await openRowMenu(parent)).getByRole("menuitem", { name: "删除" }).click();

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

test("annotation threads share the same moderation rule", async ({ page }) => {
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
        // Explicit timestamps: nested creates land in the same millisecond and
        // `orderBy createdAt asc` then returns them in random order, which made
        // "the first delete button" flip between the two comments across runs.
        create: [
          {
            workspaceId,
            paperId,
            authorId: ownerId,
            body: "thread comment by owner",
            createdAt: new Date(Date.now() - 60_000)
          },
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
  // Three ⋮ menus: the annotation's own, then one per comment.
  await expect(thread.getByRole("button", { name: "更多操作" })).toHaveCount(3);

  // Menu 0 belongs to the annotation; the owner's comment was created first, so
  // its menu is the first comment menu.
  await (await openRowMenu(thread, 1)).getByRole("menuitem", { name: "编辑" }).click();
  await page.locator("article textarea").fill("thread comment edited");
  await page.getByRole("article").getByRole("button", { name: "保存" }).click();
  await expect(page.locator("article textarea")).toHaveCount(0);
  expect((await prisma.comment.findUniqueOrThrow({ where: { id: mineId } })).body).toBe(
    "thread comment edited"
  );

  // Menu 1 again: the annotation's own delete sits in menu 0.
  const editedThread = page.locator("article", { hasText: "thread comment edited" });
  await (await openRowMenu(editedThread, 1)).getByRole("menuitem", { name: "删除" }).click();
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

test("replying nests the comment one level in with an @name label", async ({ page }) => {
  await signIn(page, memberEmail);
  await page.goto(`/papers/${paperId}`);
  await page.getByRole("button", { name: "评论", exact: true }).click();

  // Open the inline composer on the owner's comment.
  await page
    .locator("article", { hasText: "owner edited body" })
    .getByRole("button", { name: "回复", exact: true })
    .click();
  const composer = page.locator("textarea[placeholder^='回复 @']");
  await expect(composer).toBeVisible();
  await composer.fill("member threaded reply");
  // The composer's submit shares the label with the reply action; it is the
  // last 回复 button inside the article that holds the composer.
  await page
    .locator("article")
    .filter({ has: composer })
    .getByRole("button", { name: "回复", exact: true })
    .last()
    .click();

  // The reply renders indented (single level) and names who it answers.
  const reply = page.locator("article.ml-5", { hasText: "member threaded reply" });
  await expect(reply).toBeVisible();
  await expect(reply.getByText(/^@Comment Edit Owner/)).toBeVisible();

  const saved = await prisma.comment.findFirst({ where: { body: "member threaded reply" } });
  expect(saved?.parentId).toBe(ownComment);

  // Replies can themselves be replied to: answer the member's reply as the
  // owner; it lands at the same indent level, @-labeled with the member.
  await signIn(page, ownerEmail);
  await page.goto(`/papers/${paperId}`);
  await page.getByRole("button", { name: "评论", exact: true }).click();
  await reply.getByRole("button", { name: "回复", exact: true }).click();
  const nested = page.locator("textarea[placeholder^='回复 @']");
  await nested.fill("owner answers the reply");
  await page
    .locator("article")
    .filter({ has: nested })
    .getByRole("button", { name: "回复", exact: true })
    .last()
    .click();

  const nestedReply = page.locator("article.ml-5", { hasText: "owner answers the reply" });
  await expect(nestedReply).toBeVisible();
  await expect(nestedReply.getByText(/^@Comment Edit Member/)).toBeVisible();

  // The member filter keeps whole threads: filtering by the member still
  // shows the owner's root as context.
  await page.getByLabel("按成员筛选").selectOption(memberId);
  await expect(page.getByText("owner edited body")).toBeVisible();
  await expect(page.getByText("member threaded reply")).toBeVisible();
});
