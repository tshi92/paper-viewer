import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";

/**
 * The library's source filter and the origin shown on each row.
 *
 * A conference paper stores the literal string "conference" in `Paper.source`,
 * with the venue and year in its ConferenceEntry rows — so the row has to read
 * those to say "SOSP 2026", and the filter lists one option per edition rather
 * than a single "conference" bucket.
 */
const password = "library-source-e2e-password";

let workspaceId: string;
let userId: string;
let email: string;
let run: string;
/** The SOSP paper, opened directly to check the header carries its edition. */
let sospPaperId: string;
const paperIds: string[] = [];
const entryIds: string[] = [];

function title(name: string): string {
  return `${name} ${run}`;
}

test.beforeAll(async () => {
  run = randomUUID().slice(0, 8);
  email = `library-source-e2e-${run}@example.com`;

  const user = await prisma.user.create({
    data: {
      email,
      name: `Library Source E2E ${run}`,
      passwordHash: await bcrypt.hash(password, 10),
      memberships: {
        create: { role: "owner", workspace: { create: { name: `Library Source E2E ${run}` } } }
      }
    },
    include: { memberships: true }
  });
  userId = user.id;
  workspaceId = user.memberships[0]!.workspaceId;

  async function addPaper(name: string, data: { source: string; arxivId?: string }) {
    const paper = await prisma.paper.create({
      data: {
        title: title(name),
        authors: ["Source Fixture"],
        source: data.source,
        ...(data.arxivId ? { arxivId: `${data.arxivId}-${run}` } : {}),
        workspacePapers: { create: { workspaceId, importedById: userId } }
      }
    });
    paperIds.push(paper.id);
    return paper.id;
  }

  const sospId = await addPaper("Conference Paper", { source: "conference" });
  sospPaperId = sospId;
  // Also carries an arXiv id: identity resolution matches preprints to accepted
  // papers, and the venue must still win on the row.
  const preprintAtOsdi = await addPaper("Preprint At Conference", {
    source: "arxiv",
    arxivId: "2608.11111"
  });
  await addPaper("Plain Preprint", { source: "arxiv", arxivId: "2608.22222" });
  await addPaper("Manual Upload", { source: "manual" });

  for (const [paperId, venue, year] of [
    [sospId, "SOSP", 2026],
    [preprintAtOsdi, "OSDI", 2025]
  ] as const) {
    const entry = await prisma.conferenceEntry.create({ data: { venue, year, paperId } });
    entryIds.push(entry.id);
  }
});

test.afterAll(async () => {
  for (const id of entryIds) {
    await prisma.conferenceEntry.delete({ where: { id } }).catch(() => undefined);
  }
  for (const id of paperIds) {
    await prisma.paper.delete({ where: { id } }).catch(() => undefined);
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
  await expect(page).toHaveURL(/\/(today)?$/);
}

test("a conference row names its venue and year instead of the word 'conference'", async ({ page }) => {
  await signIn(page);
  await page.goto("/library");

  const conferenceRow = page.locator("div", { hasText: title("Conference Paper") }).last();
  await expect(conferenceRow).toContainText("SOSP 2026");
  await expect(conferenceRow).not.toContainText("conference");

  // The preprint that was accepted somewhere shows the venue, not its arXiv id.
  const preprintRow = page.locator("div", { hasText: title("Preprint At Conference") }).last();
  await expect(preprintRow).toContainText("OSDI 2025");

  // A preprint with no conference entry keeps the arXiv id, which is what a
  // reader would copy.
  const plainRow = page.locator("div", { hasText: title("Plain Preprint") }).last();
  await expect(plainRow).toContainText("arXiv:2608.22222");
});

test("the paper's own header names the edition, as its library row does", async ({ page }) => {
  await signIn(page);
  await page.goto(`/papers/${sospPaperId}`);

  // Ahead of the identifiers on the same line: the venue is what a reader looks
  // for, and it was only ever on the library row before.
  const header = page.locator("h1", { hasText: title("Conference Paper") }).locator("..");
  await expect(header).toContainText("SOSP 2026");
  await expect(header).not.toContainText("conference");
});

test("the source filter lists every edition separately and narrows to one", async ({ page }) => {
  await signIn(page);
  await page.goto("/library");

  await page.getByRole("button", { name: /来源/ }).click();
  // Scoped to the open panel: "SOSP 2026" also appears on the row itself.
  const panel = page.getByRole("listbox", { name: "来源：" });
  await expect(panel.getByRole("option")).toHaveCount(5); // 全部 + 2 editions + arXiv + 手动上传
  await expect(panel.getByRole("option", { name: /SOSP 2026/ })).toBeVisible();
  await expect(panel.getByRole("option", { name: /OSDI 2025/ })).toBeVisible();

  await panel.getByRole("option", { name: /SOSP 2026/ }).click();
  await expect(page).toHaveURL(/source=conf%3ASOSP%3A2026/);
  await expect(page.getByText(title("Conference Paper"))).toBeVisible();
  await expect(page.getByText(title("Plain Preprint"))).toHaveCount(0);
  await expect(page.getByText(title("Manual Upload"))).toHaveCount(0);
  // The accepted preprint filters under its venue, not under arXiv.
  await expect(page.getByText(title("Preprint At Conference"))).toHaveCount(0);
});

test("filtering by arXiv excludes papers that also belong to a conference", async ({ page }) => {
  await signIn(page);
  await page.goto("/library?source=arxiv");

  await expect(page.getByText(title("Plain Preprint"))).toBeVisible();
  await expect(page.getByText(title("Preprint At Conference"))).toHaveCount(0);
  await expect(page.getByText(title("Conference Paper"))).toHaveCount(0);
});
