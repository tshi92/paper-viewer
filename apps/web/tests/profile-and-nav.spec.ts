import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";

/**
 * Two production complaints from the same batch:
 * 1. invited members had no way to set a display name — now Settings → General
 *    carries a profile form and names replace emails in the header/members list;
 * 2. opening a paper from Today/Conferences highlighted the Library tab,
 *    because /papers was hard-wired under Library. Paper links now carry
 *    ?from= and the top nav follows it.
 */
const password = "profile-nav-e2e-password";

let workspaceId: string;
let userId: string;
let paperId: string;
let digestId: string;
let email: string;
let run: string;

test.beforeAll(async () => {
  run = randomUUID().slice(0, 8);
  email = `profile-nav-e2e-${run}@example.com`;

  const user = await prisma.user.create({
    data: {
      email,
      // Deliberately no name: the display-name test sets it through the UI.
      passwordHash: await bcrypt.hash(password, 10),
      memberships: {
        create: { role: "owner", workspace: { create: { name: `Profile Nav E2E ${run}` } } }
      }
    },
    include: { memberships: true }
  });
  userId = user.id;
  workspaceId = user.memberships[0]!.workspaceId;

  const paper = await prisma.paper.create({
    data: {
      title: `Digest Nav Paper ${run}`,
      authors: ["Nav Author"],
      source: "manual",
      abstract: "Fixture abstract for nav highlight checks."
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

test("setting a display name replaces the email in the header and members list", async ({ page }) => {
  await signIn(page);

  // Before: the header shows the email.
  await expect(page.locator("header").getByText(email)).toBeVisible();

  await page.goto("/settings/general");
  await page.getByLabel("显示名称").fill(`Zoe E2E ${run}`);
  await page.getByRole("button", { name: "保存" }).click();

  await expect(page.getByText("显示名称已保存。")).toBeVisible();
  await expect(page.locator("header").getByText(`Zoe E2E ${run}`)).toBeVisible();
  await expect(page.locator("header").getByText(email)).toHaveCount(0);

  // The members list shows the name with the email demoted to metadata.
  // (Scoped to main: the header also carries the new name.)
  await page.goto("/settings/members");
  await expect(page.locator("main").getByText(`Zoe E2E ${run}`)).toBeVisible();
  await expect(page.locator("main").getByText(email)).toBeVisible();
});

test("the top nav highlights the tab a paper was opened from", async ({ page }) => {
  await signIn(page);
  const nav = page.locator("header nav");

  // Opened from Today: the Today tab is current, Library is not.
  await page.goto(`/papers/${paperId}?from=today`);
  await expect(nav.getByRole("link", { name: "今日" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "文库" })).not.toHaveAttribute("aria-current", "page");

  // Opened from Conferences.
  await page.goto(`/papers/${paperId}?from=conferences`);
  await expect(nav.getByRole("link", { name: "顶会" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "文库" })).not.toHaveAttribute("aria-current", "page");

  // No origin: Library stays the default owner of paper pages.
  await page.goto(`/papers/${paperId}`);
  await expect(nav.getByRole("link", { name: "文库" })).toHaveAttribute("aria-current", "page");
});
