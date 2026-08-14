import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";

/**
 * A conference paper that nobody has saved yet opens as a preview, and its PDF
 * has to be readable end to end there.
 *
 * It used to be an `<iframe>` around the file, which handed the job to the
 * browser's built-in PDF plugin. On WebKit — every iOS browser — that plugin
 * renders one static page inside a frame, so a phone showed page 1 and offered
 * no way to reach page 2. The preview now runs pdf.js itself, so the assertions
 * below are about the whole document being there and a later page really
 * rasterising, not just something being visible.
 *
 * The suite only drives Chromium, which never had the bug; the narrow viewport
 * is the reported shape of the problem, and what the specs can pin is that the
 * preview no longer depends on a plugin at all.
 */
const fixture = readFileSync(join(__dirname, "fixtures", "multipage-paper.pdf"));
const FIXTURE_PAGES = 6;
const password = "preview-pdf-e2e-password";
const RENDER_TIMEOUT_MS = 30_000;

let pdfServer: Server;
let workspaceId: string;
let userId: string;
let paperId: string;
let email: string;
let venue: string;

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
  email = `preview-pdf-e2e-${run}@example.com`;
  venue = `PREVIEWPDF${run}`.toUpperCase();

  const user = await prisma.user.create({
    data: {
      email,
      name: `Preview PDF E2E ${run}`,
      passwordHash: await bcrypt.hash(password, 10),
      memberships: {
        create: { role: "owner", workspace: { create: { name: `Preview PDF E2E ${run}` } } }
      }
    },
    include: { memberships: true }
  });
  userId = user.id;
  workspaceId = user.memberships[0]!.workspaceId;

  // A conference entry, deliberately not saved into the workspace: that is what
  // makes the paper page render as a preview.
  const paper = await prisma.paper.create({
    data: {
      title: `Preview PDF Fixture ${run}`,
      authors: ["Preview Author"],
      source: "conference",
      sourceId: `${venue.toLowerCase()}-2025-${run}`,
      pdfUrl,
      conferenceEntries: { create: { venue, year: 2025 } }
    }
  });
  paperId = paper.id;
});

test.afterAll(async () => {
  if (paperId) await prisma.paper.delete({ where: { id: paperId } }).catch(() => undefined);
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  await prisma.$disconnect();
  await new Promise<void>((resolve) => pdfServer.close(() => resolve()));
});

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("邮箱").fill(email);
  await page.getByPlaceholder("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/(today)?$/);
}

/** The element the reader scrolls; `.pdfViewer` is the page stack inside it. */
function scrollContainer(page: Page): Locator {
  return page.locator(".pdfViewer").locator("..");
}

/** A page counts as rendered once pdf.js has put a canvas of real size in it. */
function renderedCanvas(page: Page, pageNumber: number): Locator {
  return page.locator(`.pdfViewer .page[data-page-number="${pageNumber}"] canvas`);
}

test("a preview renders the whole PDF, not just its first page", async ({ page }) => {
  // The width the problem was reported at.
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto(`/papers/${paperId}`);

  // Unsaved, so this is the read-only preview and not the annotating workspace.
  await expect(page.getByText("预览模式", { exact: false })).toBeVisible();
  // No plugin in the loop any more — that dependency was the bug.
  await expect(page.locator("iframe")).toHaveCount(0);

  await expect(renderedCanvas(page, 1)).toBeVisible({ timeout: RENDER_TIMEOUT_MS });
  // Every page is laid out, so the document can be scrolled through.
  await expect(page.locator(".pdfViewer .page")).toHaveCount(FIXTURE_PAGES);

  // And a page well past the fold actually rasterises once scrolled to, which
  // is the part an iframed plugin could not do.
  await scrollContainer(page).evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(renderedCanvas(page, FIXTURE_PAGES)).toBeVisible({ timeout: RENDER_TIMEOUT_MS });
});

test("a preview zooms the PDF on its own, and fits back to the page width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto(`/papers/${paperId}`);

  const firstPage = page.locator('.pdfViewer .page[data-page-number="1"]');
  await expect(renderedCanvas(page, 1)).toBeVisible({ timeout: RENDER_TIMEOUT_MS });
  const fitted = (await firstPage.boundingBox())!.width;

  await page.getByRole("button", { name: "放大" }).click();
  await expect.poll(async () => (await firstPage.boundingBox())!.width).toBeGreaterThan(fitted + 1);

  await page.getByRole("button", { name: "适应页宽" }).click();
  await expect
    .poll(async () => Math.abs((await firstPage.boundingBox())!.width - fitted))
    .toBeLessThan(2);
});
