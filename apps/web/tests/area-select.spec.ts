import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_ANNOTATION_LABELS } from "@paper-viewer/core/labels";
import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";

/**
 * Marking a region without a mouse.
 *
 * react-pdf-highlighter's own area selection cannot serve a touch screen at
 * all: it is gated on `event.altKey`, which no touch event carries, and it
 * listens for `mousedown`/`mousemove`/`mouseup`, which a finger dragging across
 * a page never produces — that gesture scrolls. So a phone had text
 * highlighting and nothing else. The rail's area button arms a pointer-driven
 * drag instead, which this covers end to end.
 *
 * Driven with the mouse because the suite runs desktop Chromium; the code path
 * is the same one a finger takes, since it is written against pointer events
 * and never asks what kind of pointer it has.
 */
// Six pages, so there is somewhere to scroll to and back from.
const fixture = readFileSync(join(__dirname, "fixtures", "multipage-paper.pdf"));
const password = "area-select-e2e-password";

let pdfServer: Server;
let workspaceId: string;
let userId: string;
let paperId: string;
/** The no-jump test measures scroll position, so it needs a page nobody else marked up. */
let quietPaperId: string;
let email: string;

function startPdfServer(): Promise<string> {
  return new Promise((resolve) => {
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
}

test.beforeAll(async () => {
  const pdfUrl = await startPdfServer();
  const run = randomUUID().slice(0, 8);
  email = `area-select-e2e-${run}@example.com`;

  const user = await prisma.user.create({
    data: {
      email,
      name: `Area Select E2E ${run}`,
      passwordHash: await bcrypt.hash(password, 10),
      memberships: {
        create: { role: "owner", workspace: { create: { name: `Area Select E2E ${run}` } } }
      }
    },
    include: { memberships: true }
  });
  userId = user.id;
  workspaceId = user.memberships[0]!.workspaceId;

  await prisma.label.createMany({
    data: DEFAULT_ANNOTATION_LABELS.map((label) => ({
      workspaceId,
      name: label.name,
      color: label.color,
      scope: "annotation" as const
    }))
  });

  const paper = await prisma.paper.create({
    data: {
      title: `Area Select Fixture ${run}`,
      authors: ["E2E Author"],
      source: "manual",
      pdfUrl,
      workspacePapers: { create: { workspaceId, importedById: userId } }
    }
  });
  paperId = paper.id;

  const quietPaper = await prisma.paper.create({
    data: {
      title: `Area Select Quiet ${run}`,
      authors: ["E2E Author"],
      source: "manual",
      pdfUrl,
      workspacePapers: { create: { workspaceId, importedById: userId } }
    }
  });
  quietPaperId = quietPaper.id;
});

test.afterAll(async () => {
  for (const id of [paperId, quietPaperId]) {
    if (id) await prisma.paper.delete({ where: { id } }).catch(() => undefined);
  }
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

/** The element pdf.js scrolls; `.pdfViewer` is the page stack inside it. */
function scroller(page: Page) {
  return page.locator(".pdfViewer").locator("..");
}

test("the area tool marks a region without ⌥, and disarms itself afterwards", async ({ page }) => {
  await signIn(page);
  await page.goto(`/papers/${paperId}`);

  const canvas = page.locator(".page canvas").first();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const canvasBox = (await canvas.boundingBox())!;

  const areaButton = page.getByRole("button", { name: "框选" });
  const capture = page.getByTestId("pdf-area-capture");

  // Nothing intercepts the document until the tool is armed, so ordinary
  // reading — scrolling, selecting text — is untouched.
  await expect(capture).toHaveCount(0);
  await areaButton.click();
  await expect(areaButton).toHaveAttribute("aria-pressed", "true");
  await expect(capture).toBeVisible();

  // No Alt anywhere in this gesture.
  await page.mouse.move(canvasBox.x + 60, canvasBox.y + 100);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 260, canvasBox.y + 220, { steps: 12 });
  await page.mouse.up();

  // One drag, one region: the tool lets go of the document immediately, since
  // holding it would leave the page unscrollable.
  await expect(capture).toHaveCount(0);
  await expect(areaButton).toHaveAttribute("aria-pressed", "false");

  await page.getByRole("button", { name: "idea" }).click();
  await page.getByRole("button", { name: "保存标注" }).click();

  await expect(page.getByText("划区")).toBeVisible();

  // The thumbnail has to be a picture of the region, not merely present. The
  // crop is taken from the page's canvas at `devicePixelRatio`, so a mismatch
  // between that and the canvas's real backing scale reads from the wrong
  // rectangle and stores a blank image — which looks, in the sidebar, exactly
  // like a thumbnail that never rendered.
  const thumbnail = page.locator('img[alt="划区截图"]').first();
  await expect(thumbnail).toBeVisible({ timeout: 15_000 });
  // It is served lazily from an API route, so it is in the DOM — with a border,
  // and therefore "visible" — for a moment before any pixels arrive.
  await expect
    .poll(() => thumbnail.evaluate((node: HTMLImageElement) => node.naturalWidth), {
      timeout: 15_000
    })
    .toBeGreaterThan(0);
  const drawn = await thumbnail.evaluate((node: HTMLImageElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = node.naturalWidth;
    canvas.height = node.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(node, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      // Anything appreciably darker than the page: text, rules, figures.
      if (data[i + 3]! > 0 && data[i]! < 200) ink++;
    }
    return { width: canvas.width, height: canvas.height, ink };
  });
  expect(drawn.width).toBeGreaterThan(20);
  expect(drawn.height).toBeGreaterThan(20);
  expect(drawn.ink).toBeGreaterThan(0);

  // The box has to paint where it was drawn, in the label's colour — the same
  // bar the ⌥ path is held to.
  const painted = page
    .locator('.pv-highlight[data-annotation-type="area"]')
    .locator('[style*="background"]')
    .first();
  await expect(painted).toBeVisible({ timeout: 15_000 });
  await expect(painted).toHaveCSS("background-color", "rgb(168, 85, 247)");
  const paintedBox = (await painted.boundingBox())!;
  expect(paintedBox.width).toBeGreaterThan(20);
  expect(paintedBox.height).toBeGreaterThan(20);

  // Stored, not just drawn. Six pages of canvas keep `load` pending well past
  // the point the app is usable, so the wait stops at the document.
  await page.reload({ waitUntil: "domcontentloaded" });
  // A rendered page proves the client bundle is running, so the tab click below
  // lands on a hydrated button rather than server-rendered markup.
  await expect(page.locator(".page canvas").first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "标注" }).click();
  await expect(page.getByText("划区")).toBeVisible();
});

test("a tap that never became a drag leaves no annotation behind", async ({ page }) => {
  await signIn(page);
  await page.goto(`/papers/${paperId}`);

  await expect(page.locator(".page canvas").first()).toBeVisible({ timeout: 30_000 });
  const before = await prisma.annotation.count({ where: { paperId } });

  // Measured against the pane rather than a page canvas: earlier tests leave
  // annotations behind, and repainting the highlight layers swaps the canvas
  // node out from under a locator that has already resolved.
  const pane = (await scroller(page).boundingBox())!;
  await page.getByRole("button", { name: "框选" }).click();
  await page.mouse.move(pane.x + 120, pane.y + 200);
  await page.mouse.down();
  await page.mouse.up();

  // No tip, and nothing saved: changing your mind costs nothing.
  await expect(page.getByRole("button", { name: "保存标注" })).toHaveCount(0);
  await expect(page.getByTestId("pdf-area-capture")).toHaveCount(0);
  expect(await prisma.annotation.count({ where: { paperId } })).toBe(before);
});

test("saving a region leaves the document exactly where it was", async ({ page }) => {
  await signIn(page);
  await page.goto(`/papers/${quietPaperId}`);
  await expect(page.locator(".page canvas").first()).toBeVisible({ timeout: 30_000 });

  // Read somewhere other than the very top, which is where the jump shows.
  await scroller(page).evaluate((node) => {
    node.scrollTop = 400;
  });
  await expect.poll(() => scroller(page).evaluate((node) => node.scrollTop)).toBeGreaterThan(300);
  const before = await scroller(page).evaluate((node) => node.scrollTop);

  const pane = (await scroller(page).boundingBox())!;
  await page.getByRole("button", { name: "框选" }).click();
  await page.mouse.move(pane.x + 100, pane.y + 160);
  await page.mouse.down();
  await page.mouse.move(pane.x + 300, pane.y + 300, { steps: 10 });
  await page.mouse.up();

  await page.getByRole("button", { name: "question" }).click();
  await page.getByRole("button", { name: "保存标注" }).click();
  await expect(page.getByText("划区")).toBeVisible();

  // Selecting a mark from the sidebar scrolls it into view, and saving selects
  // the new one — but the reader is already looking at it, so the same scroll
  // would just yank the page out from under them.
  const after = await scroller(page).evaluate((node) => node.scrollTop);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
});

test("hovering the area tool explains the ⌥ shortcut a mouse can use instead", async ({ page }) => {
  await signIn(page);
  await page.goto(`/papers/${paperId}`);
  await expect(page.locator(".page canvas").first()).toBeVisible({ timeout: 30_000 });

  const tooltip = page.getByRole("tooltip").filter({ hasText: "框选" });
  await expect(tooltip).toHaveCSS("opacity", "0");

  await page.getByRole("button", { name: "框选" }).hover();
  await expect(tooltip).toHaveCSS("opacity", "1");
  await expect(tooltip).toContainText("⌥");

  // Opacity alone proves nothing about whether it can be seen. The rail is a
  // narrow strip of buttons and the tooltip hangs outside it, so one
  // `overflow: hidden` anywhere above cuts it away entirely — which is what
  // happened, and which neither `toBeVisible` nor a bounding box notices.
  const clippedBy = await tooltip.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (getComputedStyle(ancestor).overflow === "visible") continue;
      const box = ancestor.getBoundingClientRect();
      const escapes =
        rect.left < box.left - 0.5 ||
        rect.right > box.right + 0.5 ||
        rect.top < box.top - 0.5 ||
        rect.bottom > box.bottom + 0.5;
      if (escapes) return ancestor.className;
    }
    return null;
  });
  expect(clippedBy).toBeNull();

  // And it gets out of the way once the tool is armed: clicking the button
  // focuses it, and a tooltip tied to focus would sit over the document for the
  // whole drag — right where the region is being drawn.
  await page.getByRole("button", { name: "框选" }).click();
  await expect(page.getByRole("tooltip").filter({ hasText: "框选" })).toHaveCount(0);
});

test("the controls sit within reach on a phone, without scrolling the page", async ({ page }) => {
  // Pinned to the pane's bottom corner they were below the fold: the pane is a
  // viewport tall and starts under the paper's header card.
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto(`/papers/${paperId}`);
  await expect(page.locator(".page canvas").first()).toBeVisible({ timeout: 30_000 });

  for (const name of ["框选", "放大", "适应页宽", "缩小"]) {
    const box = (await page.getByRole("button", { name }).boundingBox())!;
    expect(box.y, name).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, name).toBeLessThanOrEqual(844);
  }
});
