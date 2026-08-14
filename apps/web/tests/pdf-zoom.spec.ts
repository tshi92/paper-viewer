import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";

/**
 * Zooming the annotating viewer, and having it stay zoomed.
 *
 * react-pdf-highlighter re-applies its `pdfScaleValue` — "page-width" — every
 * time its container is resized, without asking whether the reader had picked a
 * scale. Enlarging the page past the pane's width brings up a horizontal
 * scrollbar, and where scrollbars take layout space that shrinks the container,
 * trips the observer, and puts the scale back half a second later. Zooming out
 * never adds a scrollbar, so it looked fine; on overlay scrollbars (macOS's
 * default) nothing resized and both directions worked, which is why this only
 * showed up for some people.
 *
 * The assertions therefore wait out the library's debounce rather than checking
 * the scale immediately, which is what made the bug invisible.
 */
const fixture = readFileSync(join(__dirname, "fixtures", "multipage-paper.pdf"));
const password = "pdf-zoom-e2e-password";

/** The library debounces its re-fit by 500ms; comfortably past it. */
const SETTLE_MS = 1_500;

// A cold `next dev` route plus two settle waits does not fit the 30s default.
test.setTimeout(90_000);

let pdfServer: Server;
let workspaceId: string;
let userId: string;
let paperId: string;
let email: string;

test.beforeAll(async () => {
  const pdfUrl = await new Promise<string>((resolve) => {
    pdfServer = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": fixture.length });
      response.end(fixture);
    });
    pdfServer.listen(0, "127.0.0.1", () => {
      const address = pdfServer.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}/multipage-paper.pdf`);
    });
  });

  const run = randomUUID().slice(0, 8);
  email = `pdf-zoom-e2e-${run}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      name: `Pdf Zoom E2E ${run}`,
      passwordHash: await bcrypt.hash(password, 10),
      memberships: {
        create: { role: "owner", workspace: { create: { name: `Pdf Zoom E2E ${run}` } } }
      }
    },
    include: { memberships: true }
  });
  userId = user.id;
  workspaceId = user.memberships[0]!.workspaceId;

  const paper = await prisma.paper.create({
    data: {
      title: `Pdf Zoom Fixture ${run}`,
      authors: ["E2E Author"],
      source: "manual",
      pdfUrl,
      workspacePapers: { create: { workspaceId, importedById: userId } }
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

function firstPage(page: Page): Locator {
  return page.locator('.pdfViewer .page[data-page-number="1"]');
}

async function pageWidth(page: Page): Promise<number> {
  return (await firstPage(page).boundingBox())!.width;
}

test("zooming in survives the scrollbar it brings up", async ({ page }) => {
  await signIn(page);
  await page.goto(`/papers/${paperId}`);
  await expect(page.locator(".page canvas").first()).toBeVisible({ timeout: 30_000 });

  const fitted = await pageWidth(page);

  // Far enough in that the page is wider than the pane, which is what puts a
  // horizontal scrollbar under it.
  for (let press = 0; press < 3; press++) {
    await page.getByRole("button", { name: "放大" }).click();
  }
  await expect.poll(() => pageWidth(page)).toBeGreaterThan(fitted * 1.4);

  // The regression was here: the page snapped back to the pane's width once the
  // library's resize handler caught up.
  await page.waitForTimeout(SETTLE_MS);
  expect(await pageWidth(page)).toBeGreaterThan(fitted * 1.4);
});

test("zooming out holds too, and fit-to-width comes back to the pane", async ({ page }) => {
  await signIn(page);
  await page.goto(`/papers/${paperId}`);
  await expect(page.locator(".page canvas").first()).toBeVisible({ timeout: 30_000 });

  const fitted = await pageWidth(page);

  await page.getByRole("button", { name: "缩小" }).click();
  await expect.poll(() => pageWidth(page)).toBeLessThan(fitted * 0.95);
  await page.waitForTimeout(SETTLE_MS);
  expect(await pageWidth(page)).toBeLessThan(fitted * 0.95);

  // Fit is the way back to following the pane, so it has to restore the
  // automatic behaviour and not merely set today's number.
  await page.getByRole("button", { name: "适应页宽" }).click();
  await expect.poll(async () => Math.abs(fitted - (await pageWidth(page)))).toBeLessThan(2);
  await page.waitForTimeout(SETTLE_MS);
  expect(Math.abs(fitted - (await pageWidth(page)))).toBeLessThan(2);
});
