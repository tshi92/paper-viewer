import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";

/**
 * Chat replies come back as markdown, so the same source has to survive three
 * hops: rendered in the chat, saved into a comment, and rendered there — while
 * the copy buttons keep handing back the raw source, newlines included.
 */
const password = "markdown-copy-e2e-password";

const assistantReply = [
  "## Main contribution",
  "",
  "This paper proposes **three** things:",
  "",
  "1. A retrieval-augmented reader",
  "2. A rebuilt benchmark",
  "",
  "### Usage",
  "",
  "```python",
  "model.fit(x_train_long_enough_to_need_a_scrollbar, y_train)",
  "```",
  "",
  "See the `tensor` argument."
].join("\n");

let workspaceId: string;
let userId: string;
let paperId: string;
let email: string;

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test.beforeAll(async () => {
  const run = randomUUID().slice(0, 8);
  email = `markdown-copy-e2e-${run}@example.com`;

  const user = await prisma.user.create({
    data: {
      email,
      name: `Markdown Copy E2E ${run}`,
      passwordHash: await bcrypt.hash(password, 10),
      memberships: {
        create: { role: "owner", workspace: { create: { name: `Markdown Copy E2E ${run}` } } }
      }
    },
    include: { memberships: true }
  });
  userId = user.id;
  workspaceId = user.memberships[0]!.workspaceId;

  const paper = await prisma.paper.create({
    data: {
      title: `Markdown Copy Fixture Paper ${run}`,
      authors: ["E2E Author"],
      source: "manual",
      abstract: "A fixture abstract.",
      workspacePapers: { create: { workspaceId, importedById: userId } }
    }
  });
  paperId = paper.id;

  await prisma.paperChatMessage.createMany({
    data: [
      { paperId, userId, role: "user", content: "What is the contribution?" },
      { paperId, userId, role: "assistant", content: assistantReply }
    ]
  });
});

test.afterAll(async () => {
  if (paperId) {
    await prisma.paperChatMessage.deleteMany({ where: { paperId } });
    await prisma.paper.delete({ where: { id: paperId } }).catch(() => undefined);
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
  await expect(page).toHaveURL(/\/library/);
}

async function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

test("chat renders assistant markdown and copies the raw source", async ({ page }) => {
  await signIn(page);
  await page.goto(`/papers/${paperId}`);
  await page.getByRole("button", { name: "AI 对话" }).click();

  await expect(page.getByRole("heading", { name: "Main contribution", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Usage", level: 3 })).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(2);
  await expect(page.locator("pre code")).toContainText(
    "model.fit(x_train_long_enough_to_need_a_scrollbar, y_train)"
  );
  // A long code line scrolls inside its own block instead of widening the page.
  const layout = await page.evaluate(() => {
    const pre = document.querySelector("pre")!;
    return {
      pageOverflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      preScrolls: pre.scrollWidth > pre.clientWidth
    };
  });
  expect(layout).toEqual({ pageOverflows: false, preScrolls: true });

  // The user's own message stays plain, so the "**" is literal there.
  await expect(page.getByText("What is the contribution?")).toBeVisible();

  await page.getByRole("button", { name: "复制" }).nth(1).click();
  await expect(page.getByRole("button", { name: "已复制" })).toBeVisible();
  expect(await readClipboard(page)).toBe(assistantReply);
});

test("a saved chat reply renders as markdown in the discussion and copies raw", async ({ page }) => {
  await signIn(page);
  await page.goto(`/papers/${paperId}`);
  await page.getByRole("button", { name: "AI 对话" }).click();
  await page.getByRole("button", { name: "存入评论" }).click();
  await expect(page.getByRole("button", { name: "已存入评论" })).toBeVisible();

  const stored = await prisma.comment.findFirstOrThrow({ where: { paperId } });
  // The newlines were always in storage; only the old plain-text rendering ate them.
  expect(stored.body).toBe(assistantReply);

  await page.getByRole("button", { name: /^评论（/ }).click();
  const comment = page.locator("article", { hasText: "Main contribution" });
  await expect(comment.getByRole("heading", { name: "Main contribution", level: 2 })).toBeVisible();
  await expect(comment.getByRole("listitem")).toHaveCount(2);
  await expect(comment.locator("pre code")).toContainText(
    "model.fit(x_train_long_enough_to_need_a_scrollbar, y_train)"
  );

  await comment.getByRole("button", { name: "复制" }).click();
  expect(await readClipboard(page)).toBe(assistantReply);

  await prisma.comment.delete({ where: { id: stored.id } });
});

test.describe("in English", () => {
  test.use({ locale: "en-US" });

  test("the copy button is translated", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/library/);

    await page.goto(`/papers/${paperId}`);
    await page.getByRole("button", { name: "AI Chat" }).click();
    await expect(page.getByRole("heading", { name: "Main contribution", level: 2 })).toBeVisible();

    await page.getByRole("button", { name: "Copy" }).nth(1).click();
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await readClipboard(page)).toBe(assistantReply);
  });
});
