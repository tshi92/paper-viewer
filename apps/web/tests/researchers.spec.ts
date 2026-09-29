import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";

/**
 * The Researchers page over fixture rows: the hot-topics card and its
 * fallback, direction filter + drawer, timeline, saving, and previews under
 * the Researchers tab. Researcher rows are global, so a dev database that has
 * run a real sync also lists real people (under "other" here: their directions
 * belong to other workspaces): every list assertion first narrows the page to
 * this run with the search box.
 */
const password = "researchers-e2e-password";
const DAY = 86_400_000;

let run: string;
let email: string;
let userId: string;
let workspaceId: string;
let slugs: string[] = [];
const paperIds: Record<"one" | "two" | "three", string> = { one: "", two: "", three: "" };

const todayUtc = () => {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
};
const daysAgo = (n: number) => new Date(todayUtc() - n * DAY);
const monthStart = (offset = 0) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
};
const issueTitle = (month: Date) => `近期热点 · ${month.getUTCFullYear()} 年 ${month.getUTCMonth() + 1} 月刊`;

test.beforeAll(async () => {
  run = randomUUID().slice(0, 8);
  email = `researchers-e2e-${run}@example.com`;
  const alpha = `E2E Alpha ${run}`;
  const beta = `E2E Beta ${run}`;
  slugs = [`e2e-${run}-alpha`, `e2e-${run}-beta`];

  const user = await prisma.user.create({
    data: {
      email,
      name: `Researchers E2E ${run}`,
      passwordHash: await bcrypt.hash(password, 10),
      memberships: { create: { role: "owner", workspace: { create: { name: `Researchers E2E ${run}` } } } }
    },
    include: { memberships: true }
  });
  userId = user.id;
  workspaceId = user.memberships[0]!.workspaceId;

  await prisma.researcher.createMany({
    data: [
      { slug: slugs[0]!, name: alpha, affiliation: "Fixture University", knownFor: "Fixture systems" },
      { slug: slugs[1]!, name: beta, affiliation: "Fixture Institute", knownFor: "Fixture networks" }
    ]
  });

  const paper = async (key: "one" | "two" | "three", authors: string[], publishedAt: Date, directionId: string) => {
    const arxivId = `e2e-${run}-${key}`;
    const row = await prisma.paper.create({
      data: {
        title: `Researcher Fixture ${key} ${run}`, abstract: `Fixture abstract ${key}.`, authors,
        source: "arxiv", sourceId: arxivId, arxivId, publishedAt,
        // Directions are per workspace: these belong to the fixture workspace only.
        directions: { create: { workspaceId, directionId } }
      }
    });
    paperIds[key] = row.id;
    return row.id;
  };
  const one = await paper("one", [alpha, "Co Author", "Other Author"], daysAgo(3), "llm-serving");
  const two = await paper("two", [beta, "Co Author", alpha], daysAgo(10), "llm-serving");
  const three = await paper("three", ["Co Author", beta], daysAgo(40), "agent-harness");
  await prisma.researcherPaper.createMany({
    data: [
      { researcherSlug: slugs[0]!, paperId: one, position: 1 },
      { researcherSlug: slugs[0]!, paperId: two, position: 3 },
      { researcherSlug: slugs[1]!, paperId: two, position: 1 },
      { researcherSlug: slugs[1]!, paperId: three, position: 2 }
    ]
  });

  const observation = (n: number) => ({
    claim: `观察 ${n}。`, evidence: "例证。", directions: ["llm-serving"], papers: [`e2e-${run}-one`, `e2e-${run}-two`]
  });
  await prisma.researcherDigest.create({
    data: {
      workspaceId,
      month: monthStart(),
      content: {
        window: { from: "2026-06-29", to: "2026-09-28" },
        stats: { papers: 3, researchers: 2 },
        headline: `Fixture headline ${run}`,
        lede: "两位研究者发了 3 篇论文，做的最多的是[[llm-serving|LLM 推理服务]]。",
        observations: [1, 2, 3, 4].map(observation)
      }
    }
  });
});

test.afterAll(async () => {
  // Links, directions and library rows cascade with the papers; issues with
  // the workspace.
  await prisma.paper.deleteMany({ where: { id: { in: Object.values(paperIds).filter(Boolean) } } });
  await prisma.researcher.deleteMany({ where: { slug: { in: slugs } } });
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

async function openNarrowed(page: Page): Promise<void> {
  await page.goto("/researchers");
  await page.getByPlaceholder("搜索论文").fill(run);
}

const row = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(name) });

test("the hot-topics card shows this month's issue with tinted, unlinked highlights", async ({ page }) => {
  await signIn(page);
  await page.goto("/researchers");
  // The fixture user owns its workspace, so the admin sync button is there (not clicked: it hits GitHub and the LLM).
  await expect(page.getByRole("button", { name: "同步数据" })).toBeVisible();
  const card = page.locator("section", { has: page.getByRole("heading", { name: issueTitle(monthStart()) }) });
  await expect(card.getByText(`Fixture headline ${run}`)).toBeVisible();
  await expect(card.locator("span", { hasText: "LLM 推理服务" })).toHaveAttribute("style", /79,\s*148,\s*132/);
  await expect(card.getByRole("link")).toHaveCount(0);
  await expect(card.locator("li")).toHaveCount(4);
  await expect(page.getByText("本月刊尚未生成，显示上一期")).toHaveCount(0);
});

test("a direction filter narrows the rows and the drawer inherits it", async ({ page }) => {
  await signIn(page);
  await openNarrowed(page);
  await expect(row(page, `E2E Alpha ${run}`)).toBeVisible();
  await expect(row(page, `E2E Beta ${run}`)).toBeVisible();

  await page.getByRole("button", { name: /^Agent harness 与上下文/ }).click();
  await expect(row(page, `E2E Alpha ${run}`)).toHaveCount(0);
  await row(page, `E2E Beta ${run}`).click();

  const drawer = page.getByRole("dialog");
  const fixtureLinks = drawer.getByRole("link", { name: new RegExp(`Researcher Fixture \\w+ ${run}`) });
  await expect(drawer.getByRole("heading", { name: `E2E Beta ${run}` })).toBeVisible();
  await expect(drawer.getByText("显示 2 篇中的 1 篇")).toBeVisible();
  await expect(fixtureLinks).toHaveCount(1);
  await drawer.getByRole("button", { name: "显示全部 2 篇" }).click();
  await expect(fixtureLinks).toHaveCount(2);

  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(row(page, `E2E Beta ${run}`)).toBeFocused();
});

test("the timeline draws its axis, is remembered, and opens the drawer at a dot", async ({ page }) => {
  await signIn(page);
  await openNarrowed(page);
  await page.getByRole("button", { name: "时间轴" }).click();
  await expect(page.getByText("近两周", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: new RegExp(`Researcher Fixture three ${run}`) }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading", { name: `E2E Beta ${run}` })).toBeVisible();
  await expect(drawer.locator(`#rp-${paperIds.three}`)).toBeInViewport();

  await page.reload();
  await expect(page.getByText("近两周", { exact: true })).toBeVisible();
});

test("papers save from the drawer and open as previews under the Researchers tab", async ({ page }) => {
  await signIn(page);
  await openNarrowed(page);
  await row(page, `E2E Alpha ${run}`).click();
  const drawer = page.getByRole("dialog");

  // Saving goes through canAccessPaper: a researcher paper must be allowed.
  const first = drawer.locator(`#rp-${paperIds.one}`);
  await first.getByRole("button", { name: "存入文库" }).click();
  await expect(first.getByRole("link", { name: "在文库中显示" })).toBeVisible();

  await drawer.getByRole("link", { name: `Researcher Fixture two ${run}` }).click();
  await expect(page).toHaveURL(new RegExp(`/papers/${paperIds.two}\\?from=researchers`));
  await expect(page.getByText("预览模式", { exact: false })).toBeVisible();
  await expect(page.locator("header nav").getByRole("link", { name: "研究者" })).toHaveAttribute("aria-current", "page");
});

test("a researcher paper opened in a new tab goes back to the Researchers page", async ({ page, context }) => {
  await signIn(page);
  await openNarrowed(page);
  await row(page, `E2E Beta ${run}`).click();
  // A tab opened by a modified click has no history, so the back button falls
  // back to the tab ?from= names.
  const [tab] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("dialog").getByRole("link", { name: `Researcher Fixture three ${run}` }).click({ modifiers: ["ControlOrMeta"] })
  ]);
  await tab.getByRole("button", { name: "返回" }).click();
  await expect(tab).toHaveURL(/\/researchers$/);
});

test("without this month's issue the card shows the latest one under its own month", async ({ page }) => {
  await prisma.researcherDigest.updateMany({ where: { workspaceId }, data: { month: monthStart(-1) } });
  await signIn(page);
  await page.goto("/researchers");
  await expect(page.getByRole("heading", { name: issueTitle(monthStart(-1)) })).toBeVisible();
  await expect(page.getByText("本月刊尚未生成，显示上一期")).toBeVisible();
});
