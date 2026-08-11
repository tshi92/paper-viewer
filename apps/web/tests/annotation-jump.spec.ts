import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";

/**
 * Jumping from the sidebar to a mark on a page the reader has never scrolled to
 * is the hard case: the viewer is virtualised, so the target page has no text
 * layer — and therefore no highlight layer — until the scroll actually happens.
 * The fixture is six pages of real text so page 5 is far outside the initial
 * viewport, and both marks are seeded straight into the database so the loop
 * below measures only the jump.
 */
const fixture = readFileSync(join(__dirname, "fixtures", "multipage-paper.pdf"));
const password = "annotation-jump-e2e-password";

/** Distance the mark may sit outside the viewport and still count as landed. */
const VIEWPORT_SLACK_PX = 4;
const JUMP_TIMEOUT_MS = 5_000;

let pdfServer: Server;
let workspaceId: string;
let userId: string;
let paperId: string;
let email: string;

const NEAR_MARK = "JUMPTARGETPAGEONE";
const FAR_MARK = "JUMPTARGETPAGEFIVE";

/**
 * The fixture pages are 595×792 and each line of text is 20 units apart, so the
 * first line of a page sits just below its top edge. Scaled positions are
 * resolution independent: the library rescales them by the live viewport.
 */
function scaledPosition(pageNumber: number) {
  const rect = {
    x1: 48,
    y1: 38,
    x2: 320,
    y2: 58,
    width: 595,
    height: 792,
    pageNumber
  };
  return { boundingRect: rect, rects: [rect], pageNumber, usePdfCoordinates: false };
}

function startPdfServer(): Promise<string> {
  return new Promise((resolve) => {
    pdfServer = createServer((_request, response) => {
      response.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Length": fixture.length
      });
      response.end(fixture);
    });
    pdfServer.listen(0, "127.0.0.1", () => {
      const address = pdfServer.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}/multipage-paper.pdf`);
    });
  });
}

test.beforeAll(async () => {
  const pdfUrl = await startPdfServer();
  const run = randomUUID().slice(0, 8);
  email = `annotation-jump-e2e-${run}@example.com`;

  const user = await prisma.user.create({
    data: {
      email,
      name: `Annotation Jump E2E ${run}`,
      passwordHash: await bcrypt.hash(password, 10),
      memberships: {
        create: { role: "owner", workspace: { create: { name: `Annotation Jump E2E ${run}` } } }
      }
    },
    include: { memberships: true }
  });

  userId = user.id;
  workspaceId = user.memberships[0]!.workspaceId;

  const paper = await prisma.paper.create({
    data: {
      title: `Annotation Jump Fixture Paper ${run}`,
      authors: ["E2E Author"],
      source: "manual",
      pdfUrl,
      workspacePapers: { create: { workspaceId, importedById: userId } }
    }
  });

  paperId = paper.id;

  for (const [pageNumber, quotedText] of [
    [1, NEAR_MARK],
    [5, FAR_MARK]
  ] as const) {
    await prisma.annotation.create({
      data: {
        workspaceId,
        paperId,
        authorId: userId,
        type: "highlight",
        pageNumber,
        position: scaledPosition(pageNumber),
        quotedText
      }
    });
  }
});

test.afterAll(async () => {
  if (paperId) await prisma.paper.delete({ where: { id: paperId } }).catch(() => undefined);
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  await prisma.$disconnect();
  await new Promise<void>((resolve) => pdfServer.close(() => resolve()));
});

// The suite runs with a `zh-CN` browser locale; see playwright.config.ts.
async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("邮箱").fill(email);
  await page.getByPlaceholder("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/library/);
}

/** The element pdf.js scrolls; `.pdfViewer` is the page stack inside it. */
function scrollContainer(page: Page): Locator {
  return page.locator(".pdfViewer").locator("..");
}

async function scrollToTop(page: Page): Promise<void> {
  await scrollContainer(page).evaluate((node) => {
    node.scrollTop = 0;
  });
  await expect
    .poll(() => scrollContainer(page).evaluate((node) => node.scrollTop))
    .toBeLessThan(2);
}

/**
 * Landing means the selected mark exists — its page had to render for that — and
 * its box sits inside the scroll container's box. Playwright's `toBeVisible`
 * would pass on a mark parked ten pages below the fold, so the geometry is the
 * assertion that matters.
 */
async function expectLandedOnSelectedMark(page: Page, label: string): Promise<void> {
  const mark = page.locator('.pv-highlight[data-scrolled-to="true"] .Highlight__part').first();
  await expect(mark, label).toBeVisible({ timeout: JUMP_TIMEOUT_MS });

  await expect
    .poll(
      async () => {
        const markBox = await mark.boundingBox();
        const containerBox = await scrollContainer(page).boundingBox();
        if (!markBox || !containerBox) return false;
        return (
          markBox.y >= containerBox.y - VIEWPORT_SLACK_PX &&
          markBox.y + markBox.height <= containerBox.y + containerBox.height + VIEWPORT_SLACK_PX
        );
      },
      { message: label, timeout: JUMP_TIMEOUT_MS }
    )
    .toBe(true);
}

test("sidebar jump reaches an off-screen page on every attempt", async ({ page }) => {
  await signIn(page);
  await page.goto(`/papers/${paperId}`);

  await expect(page.locator(".textLayer span").first()).toBeVisible({ timeout: 30_000 });

  const farItem = page.getByRole("button").filter({ hasText: FAR_MARK });
  await expect(farItem).toBeVisible();

  for (let cycle = 0; cycle < 10; cycle++) {
    await scrollToTop(page);
    await farItem.click();
    await expectLandedOnSelectedMark(page, `far jump, cycle ${cycle}`);
  }
});

/**
 * Jumping back to a page that is already laid out exercises the other half: the
 * scroll callback has to stay usable after it has been driven once.
 */
test("sidebar jumps alternate between a far page and a near one", async ({ page }) => {
  await signIn(page);
  await page.goto(`/papers/${paperId}`);

  await expect(page.locator(".textLayer span").first()).toBeVisible({ timeout: 30_000 });

  const farItem = page.getByRole("button").filter({ hasText: FAR_MARK });
  const nearItem = page.getByRole("button").filter({ hasText: NEAR_MARK });

  for (let cycle = 0; cycle < 5; cycle++) {
    await farItem.click();
    await expectLandedOnSelectedMark(page, `far jump, cycle ${cycle}`);
    await nearItem.click();
    await expectLandedOnSelectedMark(page, `near jump, cycle ${cycle}`);
  }
});
