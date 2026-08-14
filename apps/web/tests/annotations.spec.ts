import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_ANNOTATION_LABELS } from "@paper-viewer/core/labels";
import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";

/**
 * The paper is anchored to a `pdfUrl`, and how the bytes reach the browser
 * depends on the environment: with object storage configured (MinIO/Blob) the
 * paper page snapshots the PDF on first open and serves it from
 * `/api/papers/:id/file`; without it — or when the snapshot upload fails — the
 * page falls back to streaming the origin through `/api/papers/:id/proxy-pdf`.
 * Either way the bytes are the fixture below, served from a throwaway local
 * server so the run stays offline and deterministic.
 */
const fixture = readFileSync(join(__dirname, "fixtures", "sample-paper.pdf"));
const password = "annotation-e2e-password";

let pdfServer: Server;
let workspaceId: string;
let userId: string;
let paperId: string;
/** The hover suite draws its own highlights, so it needs a page nobody else marked up. */
let hoverPaperId: string;
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
      resolve(`http://127.0.0.1:${port}/sample-paper.pdf`);
    });
  });
}

test.beforeAll(async () => {
  const pdfUrl = await startPdfServer();
  const run = randomUUID().slice(0, 8);
  email = `annotations-e2e-${run}@example.com`;

  const user = await prisma.user.create({
    data: {
      email,
      name: `Annotations E2E ${run}`,
      passwordHash: await bcrypt.hash(password, 10),
      memberships: {
        create: {
          role: "owner",
          workspace: { create: { name: `Annotations E2E ${run}` } }
        }
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
      title: `Annotation Fixture Paper ${run}`,
      authors: ["E2E Author"],
      source: "manual",
      pdfUrl,
      workspacePapers: { create: { workspaceId, importedById: userId } }
    }
  });

  paperId = paper.id;

  const hoverPaper = await prisma.paper.create({
    data: {
      title: `Annotation Hover Paper ${run}`,
      authors: ["E2E Author"],
      source: "manual",
      pdfUrl,
      workspacePapers: { create: { workspaceId, importedById: userId } }
    }
  });

  hoverPaperId = hoverPaper.id;
});

test.afterAll(async () => {
  if (hoverPaperId) await prisma.paper.delete({ where: { id: hoverPaperId } }).catch(() => undefined);
  if (paperId) await prisma.paper.delete({ where: { id: paperId } }).catch(() => undefined);
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  await prisma.$disconnect();
  await new Promise<void>((resolve) => pdfServer.close(() => resolve()));
});

// The suite runs with a `zh-CN` browser locale (see playwright.config.ts), so the
// UI copy asserted below — here and in the annotation flows — is the Chinese one.
async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("邮箱").fill(email);
  await page.getByPlaceholder("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/(today)?$/);
}

test("highlight → label → comment → persists after reload", async ({ page }) => {
  await signIn(page);

  await page.goto(`/papers/${paperId}`);

  // pdf.js renders the text layer after the document and page finish loading.
  const words = page.locator(".textLayer span");
  await expect(words.first()).toBeVisible({ timeout: 30_000 });

  await words.first().dblclick();

  await page.getByRole("button", { name: "method" }).click();
  await page.getByRole("button", { name: "保存标注" }).click();

  const sidebar = page.getByText("1 条");
  await expect(sidebar).toBeVisible();

  await page.getByPlaceholder("回复…").fill("interesting");
  await page.getByPlaceholder("回复…").press("Enter");
  await expect(page.getByText("interesting")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "标注" }).click();

  await expect(page.getByText("1 条")).toBeVisible();
  await expect(page.getByText("interesting")).toBeVisible();
});

/**
 * Area selections travel a different path than text ones: react-pdf-highlighter
 * emits `rects: []` (the box lives in `boundingRect` alone) and the rendered
 * highlight carries no screenshot, so both the API schema and the renderer have
 * to key off the annotation type. This covers ⌥-drag end to end.
 */
test("⌥ drag area → label → paints a coloured box and persists", async ({ page }) => {
  await signIn(page);
  await page.goto(`/papers/${paperId}`);

  const canvas = page.locator(".page canvas").first();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const canvasBox = (await canvas.boundingBox())!;

  // Alt is what `enableAreaSelection` checks; holding it down makes Playwright
  // stamp `altKey` on the mouse events the library listens to.
  await page.keyboard.down("Alt");
  await page.mouse.move(canvasBox.x + 60, canvasBox.y + 100);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 260, canvasBox.y + 220, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up("Alt");

  await page.getByRole("button", { name: "result" }).click();
  await page.getByRole("button", { name: "保存标注" }).click();

  await expect(page.getByText("划区")).toBeVisible();

  // The box must actually paint: right kind, label colour ("result" = #22c55e)
  // and a real area — an area highlight carries no rects, so a renderer that
  // treats it as a text highlight would draw nothing at all.
  // The wrapper itself is a zero-size static block; the painted box inside it
  // is what must be visible.
  const areaHighlight = page.locator('.pv-highlight[data-annotation-type="area"]');
  const painted = areaHighlight.locator('[style*="background"]').first();
  await expect(painted).toBeVisible({ timeout: 15_000 });
  await expect(painted).toHaveCSS("background-color", "rgb(34, 197, 94)");
  const paintedBox = (await painted.boundingBox())!;
  expect(paintedBox.width).toBeGreaterThan(20);
  expect(paintedBox.height).toBeGreaterThan(20);

  // Reload proves the API stored it: area positions ship `rects: []`, which an
  // over-strict schema rejects outright.
  await page.reload();
  await page.getByRole("button", { name: "标注" }).click();
  await expect(page.getByText("划区")).toBeVisible();
});

/**
 * Hovering a highlight has to show its preview *every* time. The library's own
 * `Popup`/`setTip` path did not: it suppresses tips while a text selection is
 * open and closes on a stale mouse-in flag, so the preview appeared only some of
 * the time. The loops below are the regression bar — ten clean cycles per kind.
 */
/** The card hugs the mark it describes, above it or — near the top — below it. */
async function assertAnchoredTo(
  preview: ReturnType<Page["locator"]>,
  target: ReturnType<Page["locator"]>
): Promise<void> {
  const mark = (await target.boundingBox())!;
  const card = (await preview.boundingBox())!;
  const gap = Math.min(
    Math.abs(card.y + card.height - mark.y),
    Math.abs(card.y - (mark.y + mark.height))
  );
  expect(gap).toBeLessThan(12);
  expect(card.x + card.width).toBeGreaterThan(mark.x - 40);
  expect(card.x).toBeLessThan(mark.x + mark.width + 40);
}

/**
 * Highlights are pointer-transparent (text selection must anchor through
 * them), so Playwright's actionability check rejects `.hover()` on them —
 * the app reads coordinates off container mousemove instead, and so does this.
 */
async function hoverCenter(page: Page, target: ReturnType<Page["locator"]>): Promise<void> {
  // Saving an annotation scrolls the viewer to it on a delayed retry, so a
  // coordinate measured too early points at where the highlight used to be.
  // Re-measure and re-hover until the preview actually shows; the ±1px jiggle
  // guarantees a fresh mousemove even when the coordinates repeat.
  const preview = page.getByTestId("annotation-hover-preview");
  await expect(async () => {
    // Creating an annotation scrolls the viewer elsewhere, which can leave
    // this highlight half-clipped with its centre over the page chrome.
    await target.scrollIntoViewIfNeeded();
    const box = (await target.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2 + 1);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(preview).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 15_000 });
}

async function assertHoverCycles(
  page: Page,
  target: ReturnType<Page["locator"]>,
  commentText: string
): Promise<void> {
  const preview = page.getByTestId("annotation-hover-preview");
  for (let cycle = 0; cycle < 10; cycle++) {
    await hoverCenter(page, target);
    await expect(preview, `cycle ${cycle}`).toBeVisible();
    await expect(preview.getByText(commentText), `cycle ${cycle}`).toBeVisible();
    await assertAnchoredTo(preview, target);
    // Away from the viewer entirely, so the leave timer runs to completion.
    await page.mouse.move(2, 2);
    await expect(preview, `cycle ${cycle}`).toBeHidden();
  }
}

test("hover previews appear on every pass and survive a trip into the card", async ({ page }) => {
  await signIn(page);
  await page.goto(`/papers/${hoverPaperId}`);

  const words = page.locator(".textLayer span");
  await expect(words.first()).toBeVisible({ timeout: 30_000 });

  // Text highlight carrying a first comment.
  await words.first().dblclick();
  await page.getByRole("button", { name: "method" }).click();
  await page.getByPlaceholder("首条评论（可选）").fill("hover text note");
  await page.getByRole("button", { name: "保存标注" }).click();
  await expect(page.getByText("hover text note")).toBeVisible();

  // Area annotation carrying a first comment.
  const canvas = page.locator(".page canvas").first();
  const canvasBox = (await canvas.boundingBox())!;
  await page.keyboard.down("Alt");
  await page.mouse.move(canvasBox.x + 60, canvasBox.y + 260);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 260, canvasBox.y + 380, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await page.getByPlaceholder("首条评论（可选）").fill("hover area note");
  await page.getByRole("button", { name: "保存标注" }).click();
  await expect(page.getByText("划区")).toBeVisible();

  const textPart = page.locator('.pv-highlight[data-annotation-type="highlight"] .Highlight__part').first();
  const areaBox = page.locator('.pv-highlight[data-annotation-type="area"] [style*="background"]').first();
  await expect(areaBox).toBeVisible();

  await assertHoverCycles(page, textPart, "hover text note");
  await assertHoverCycles(page, areaBox, "hover area note");

  const preview = page.getByTestId("annotation-hover-preview");

  // The card carries what the document does not show: author, labels and the
  // first comment. Neither the quoted text nor the area screenshot appears —
  // both reproduce what is already under the cursor.
  await hoverCenter(page, textPart);
  await expect(preview.getByText(/Annotations E2E/)).toBeVisible();
  await expect(preview.getByText("method")).toBeVisible();
  await expect(preview.locator("blockquote")).toHaveCount(0);
  await page.mouse.move(2, 2);
  await hoverCenter(page, areaBox);
  await expect(preview.getByText("hover area note")).toBeVisible();
  await expect(preview.locator("img")).toHaveCount(0);
  await page.mouse.move(2, 2);
  await expect(preview).toBeHidden();

  // The reported failure: the library only showed its tip while no text
  // selection was open, so once the reader had selected anything — a
  // double-clicked word here — hovering a highlight silently did nothing.
  await words.nth(3).dblclick();
  await expect(page.getByRole("button", { name: "保存标注" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.move(2, 2);
  await hoverCenter(page, textPart);
  await expect(preview).toBeVisible();
  await expect(preview.getByText("hover text note")).toBeVisible();
  await page.mouse.move(2, 2);
  await expect(preview).toBeHidden();

  // Moving from the highlight into the card keeps it open; leaving the card closes it.
  await hoverCenter(page, textPart);
  await expect(preview).toBeVisible();
  await preview.hover();
  await expect(preview).toBeVisible();
  await expect(preview.getByText("hover text note")).toBeVisible();
  await page.mouse.move(2, 2);
  await expect(preview).toBeHidden();
});
