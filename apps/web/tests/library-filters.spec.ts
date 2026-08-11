import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";

/**
 * The library filter row: time, label and reading state as dropdowns.
 *
 * Reading state is per user, and a paper nobody opened has no `ReadingStateRecord`
 * at all — the fixtures below cover both that gap and a record another member of
 * the same workspace owns, since neither may leak into the viewer's own filter.
 */
const password = "library-filters-e2e-password";

let workspaceId: string;
let userId: string;
let otherUserId: string;
let email: string;
let alphaLabelId: string;
const paperIds: string[] = [];
/** Titles carry the run id so the assertions can't collide with other suites' data. */
let run: string;

function title(name: string): string {
  return `${name} ${run}`;
}

test.beforeAll(async () => {
  run = randomUUID().slice(0, 8);
  email = `library-filters-e2e-${run}@example.com`;

  const user = await prisma.user.create({
    data: {
      email,
      name: `Library Filters E2E ${run}`,
      passwordHash: await bcrypt.hash(password, 10),
      memberships: {
        create: { role: "owner", workspace: { create: { name: `Library Filters E2E ${run}` } } }
      }
    },
    include: { memberships: true }
  });
  userId = user.id;
  workspaceId = user.memberships[0]!.workspaceId;

  const alpha = await prisma.label.create({
    data: { workspaceId, name: `alpha-${run}`, color: "#ef4444", scope: "paper" }
  });
  alphaLabelId = alpha.id;

  const other = await prisma.user.create({
    data: {
      email: `library-filters-e2e-other-${run}@example.com`,
      name: "Other member",
      passwordHash: await bcrypt.hash(password, 10),
      memberships: { create: { role: "member", workspaceId } }
    }
  });
  otherUserId = other.id;

  const fixtures: { name: string; state: "new" | "reading" | "discussed" | null; labelled: boolean }[] = [
    { name: "Reading Alpha", state: "reading", labelled: true },
    { name: "Discussed Alpha", state: "discussed", labelled: true },
    { name: "Explicitly New", state: "new", labelled: false },
    { name: "Never Opened", state: null, labelled: false },
    { name: "Read By Someone Else", state: null, labelled: false }
  ];

  for (const fixture of fixtures) {
    const paper = await prisma.paper.create({
      data: {
        title: title(fixture.name),
        authors: ["Filter Fixture"],
        source: "manual",
        workspacePapers: {
          create: {
            workspaceId,
            importedById: userId,
            ...(fixture.labelled ? { labelLinks: { create: { labelId: alphaLabelId } } } : {})
          }
        }
      }
    });
    paperIds.push(paper.id);
    if (fixture.state) {
      await prisma.readingStateRecord.create({
        data: { workspaceId, paperId: paper.id, userId, state: fixture.state }
      });
    }
  }

  // Only the other member marked this one; for our user it must still read as unread.
  await prisma.readingStateRecord.create({
    data: { workspaceId, paperId: paperIds[4]!, userId: otherUserId, state: "reading" }
  });
});

test.afterAll(async () => {
  for (const paperId of paperIds) {
    await prisma.paper.delete({ where: { id: paperId } }).catch(() => undefined);
  }
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
  if (otherUserId) await prisma.user.delete({ where: { id: otherUserId } }).catch(() => undefined);
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  await prisma.$disconnect();
});

// The suite runs with a `zh-CN` browser locale (see playwright.config.ts).
async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("邮箱").fill(email);
  await page.getByPlaceholder("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/library/);
}

/** Paper titles currently listed, in render order. */
function listedTitles(page: Page) {
  return page.locator("div.divide-y > div h2");
}

/**
 * The dropdown only reacts once React has hydrated, and under `next dev` the first
 * click after a navigation can land before that. Retrying the open until the panel
 * actually appears keeps the suite off that race without a blind sleep.
 */
async function openDropdown(page: Page, name: RegExp) {
  const trigger = page.getByRole("button", { name });
  await expect(async () => {
    await trigger.click();
    await expect(page.getByRole("listbox")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  return trigger;
}

test("reading state dropdown filters to the current user's own state", async ({ page }) => {
  await signIn(page);

  await openDropdown(page, /阅读状态/);
  await page.getByRole("option", { name: "在读" }).click();

  await expect(page).toHaveURL(/state=reading/);
  await expect(listedTitles(page)).toHaveText([title("Reading Alpha")]);
});

test("unread covers papers with no reading state record of their own", async ({ page }) => {
  await signIn(page);
  await page.goto("/library?state=new");

  // "Never Opened" has no record at all and "Read By Someone Else" only has another
  // member's; both belong under 未读 alongside the explicitly-new one.
  await expect(listedTitles(page)).toHaveText([
    title("Read By Someone Else"),
    title("Never Opened"),
    title("Explicitly New")
  ]);
});

test("changing one filter preserves the time, label and search params", async ({ page }) => {
  await signIn(page);
  await page.goto(`/library?time=month&label=${alphaLabelId}&state=reading&q=alpha`);

  await expect(page.getByRole("button", { name: /时间/ })).toContainText("本月");
  await expect(page.getByRole("button", { name: /标签/ })).toContainText(`alpha-${run}`);
  await expect(page.getByRole("button", { name: /阅读状态/ })).toContainText("在读");

  await openDropdown(page, /阅读状态/);
  await page.getByRole("option", { name: "已讨论" }).click();

  await expect(page).toHaveURL(new RegExp(`time=month.*label=${alphaLabelId}.*state=discussed.*q=alpha`));
  await expect(listedTitles(page)).toHaveText([title("Discussed Alpha")]);
});

test("dropdown closes on Escape and on an outside click", async ({ page }) => {
  await signIn(page);

  const trigger = await openDropdown(page, /时间/);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.getByRole("heading", { name: "文库" }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("arrow keys move focus through the options and Enter picks one", async ({ page }) => {
  await signIn(page);

  await openDropdown(page, /时间/);
  // Opening lands on the selected option, so one step down is the next one.
  await expect(page.getByRole("option", { name: "全部" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: "今天" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("option", { name: "全部" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("option", { name: "本月" })).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/time=month/);
});
