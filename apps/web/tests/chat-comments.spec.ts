import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";

/**
 * Saving a chat reply into the discussion is exercised against a pre-seeded
 * assistant message: asking the model for one would need a live LLM, and the
 * button only cares about the message that is already on screen.
 */
const password = "chat-comments-e2e-password";
const assistantReply = "This paper proposes a retrieval-augmented reader.";

let workspaceId: string;
let userId: string;
let paperId: string;
let email: string;

test.beforeAll(async () => {
  const run = randomUUID().slice(0, 8);
  email = `chat-comments-e2e-${run}@example.com`;

  const user = await prisma.user.create({
    data: {
      email,
      name: `Chat Comments E2E ${run}`,
      passwordHash: await bcrypt.hash(password, 10),
      memberships: {
        create: {
          role: "owner",
          workspace: { create: { name: `Chat Comments E2E ${run}` } }
        }
      }
    },
    include: { memberships: true }
  });

  userId = user.id;
  workspaceId = user.memberships[0]!.workspaceId;

  const paper = await prisma.paper.create({
    data: {
      title: `Chat Comments Fixture Paper ${run}`,
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

test("chat reply → 存入评论 → shows in the comments tab and bumps its count", async ({ page }) => {
  await signIn(page);
  await page.goto(`/papers/${paperId}`);

  await page.getByRole("button", { name: "AI 对话" }).click();
  await expect(page.getByText(assistantReply)).toBeVisible();

  const commentsTab = page.getByRole("button", { name: /^评论（/ });
  await expect(commentsTab).toHaveText("评论（0）");

  await page.getByRole("button", { name: "存入评论" }).click();

  const savedButton = page.getByRole("button", { name: "已存入评论" });
  await expect(savedButton).toBeVisible();
  await expect(savedButton).toBeDisabled();

  // The panel and the tab count both come from server props, so this also proves
  // the router refresh landed.
  await expect(commentsTab).toHaveText("评论（1）");
  await commentsTab.click();
  await expect(page.getByText(assistantReply)).toBeVisible();

  const stored = await prisma.comment.findMany({ where: { paperId } });
  expect(stored).toHaveLength(1);
  expect(stored[0]!.body).toBe(assistantReply);
  expect(stored[0]!.annotationId).toBeNull();
});
