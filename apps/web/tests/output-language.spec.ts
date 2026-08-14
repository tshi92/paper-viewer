import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";

/**
 * The AI output language: a workspace setting that decides which language paper
 * intros and the daily overview are written in. It lives under Settings → LLM
 * but is stored on ResearchPreferences, so the two things worth proving here are
 * that it round-trips without an LlmConfig row, and that saving it cannot
 * clobber the research topics sharing that row.
 */
const password = "output-language-e2e-password";

let workspaceId: string;
let ownerId: string;
let memberId: string;
let ownerEmail: string;
let memberEmail: string;
let run: string;

test.beforeAll(async () => {
  run = randomUUID().slice(0, 8);
  ownerEmail = `output-language-owner-${run}@example.com`;
  memberEmail = `output-language-member-${run}@example.com`;

  const owner = await prisma.user.create({
    data: {
      email: ownerEmail,
      name: `Output Language Owner ${run}`,
      passwordHash: await bcrypt.hash(password, 10),
      memberships: {
        create: { role: "owner", workspace: { create: { name: `Output Language E2E ${run}` } } }
      }
    },
    include: { memberships: true }
  });
  ownerId = owner.id;
  workspaceId = owner.memberships[0]!.workspaceId;

  const member = await prisma.user.create({
    data: {
      email: memberEmail,
      name: `Output Language Member ${run}`,
      passwordHash: await bcrypt.hash(password, 10),
      memberships: { create: { role: "member", workspaceId } }
    }
  });
  memberId = member.id;

  // Deliberately no LlmConfig row: a workspace on the env-level model must
  // still be able to choose a language.
  await prisma.researchPreferences.create({
    data: { workspaceId, topics: [`llm serving ${run}`], keywords: ["kv cache"] }
  });
});

test.afterAll(async () => {
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
  if (memberId) await prisma.user.delete({ where: { id: memberId } }).catch(() => undefined);
  if (ownerId) await prisma.user.delete({ where: { id: ownerId } }).catch(() => undefined);
  await prisma.$disconnect();
});

test.beforeEach(async () => {
  await prisma.researchPreferences.update({
    where: { workspaceId },
    data: { outputLanguage: "zh" }
  });
});

// The suite runs with a `zh-CN` browser locale (see playwright.config.ts).
async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("邮箱").fill(email);
  await page.getByPlaceholder("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/(today)?$/);
}

test("an owner switches the AI output language and it survives a reload", async ({ page }) => {
  await signIn(page, ownerEmail);
  await page.goto("/settings/llm");

  const select = page.getByLabel("AI 生成语言");
  await expect(select).toHaveValue("zh");

  // Under `next dev` the first interaction after a navigation can land before
  // React has hydrated, in which case the change event reaches no handler and
  // the save silently never happens. Retrying until the row actually moves is
  // the same approach the filter dropdown specs take.
  await expect(async () => {
    await select.selectOption("en");
    const row = await prisma.researchPreferences.findUnique({ where: { workspaceId } });
    expect(row?.outputLanguage).toBe("en");
  }).toPass({ timeout: 15_000 });

  // The research topics share this row; saving a language must not touch them.
  const saved = await prisma.researchPreferences.findUnique({ where: { workspaceId } });
  expect(saved?.topics).toEqual([`llm serving ${run}`]);

  await page.reload();
  await expect(page.getByLabel("AI 生成语言")).toHaveValue("en");
});

test("the interface language setting says it is the interface only", async ({ page }) => {
  await signIn(page, ownerEmail);
  await page.goto("/settings/general");

  await expect(page.getByRole("heading", { name: "界面语言" })).toBeVisible();
  await expect(page.getByText("只影响界面文字", { exact: false })).toBeVisible();
});

/**
 * Four settings pages are workspace-wide and gated on `canManageWorkspaceSettings`.
 * The marker is shown to everyone, not only to the members who are refused: an
 * admin needs to know the change lands on the whole workspace, and a member
 * needs to know why there is no save button before hunting for one.
 */
test("the workspace-wide settings pages are marked as admin-only", async ({ page }) => {
  // Six routes, each compiled on first hit by `next dev`.
  test.setTimeout(120_000);
  await signIn(page, ownerEmail);

  for (const path of ["/settings/preferences", "/settings/llm", "/settings/notifications", "/settings/members"]) {
    await page.goto(path);
    await expect(page.getByText("仅管理员可修改"), path).toBeVisible();
  }

  // Not on the two anyone may edit — a marker everywhere would say nothing.
  for (const path of ["/settings/general", "/settings/labels"]) {
    await page.goto(path);
    await expect(page.getByText("仅管理员可修改"), path).toHaveCount(0);
  }
});

test("a member sees the marker on the pages they may read but not change", async ({ page }) => {
  await signIn(page, memberEmail);

  for (const path of ["/settings/preferences", "/settings/llm"]) {
    await page.goto(path);
    await expect(page.getByText("仅管理员可修改"), path).toBeVisible();
  }
});

test("a plain member cannot read or change the output language", async ({ page }) => {
  await signIn(page, memberEmail);

  const read = await page.request.get("/api/settings/llm");
  expect(read.status()).toBe(403);

  const write = await page.request.patch("/api/settings/llm", { data: { outputLanguage: "en" } });
  expect(write.status()).toBe(403);

  const unchanged = await prisma.researchPreferences.findUnique({ where: { workspaceId } });
  expect(unchanged?.outputLanguage).toBe("zh");
});

test("an unsupported language is rejected rather than stored", async ({ page }) => {
  await signIn(page, ownerEmail);

  const response = await page.request.patch("/api/settings/llm", { data: { outputLanguage: "fr" } });
  expect(response.status()).toBe(400);

  const unchanged = await prisma.researchPreferences.findUnique({ where: { workspaceId } });
  expect(unchanged?.outputLanguage).toBe("zh");
});
