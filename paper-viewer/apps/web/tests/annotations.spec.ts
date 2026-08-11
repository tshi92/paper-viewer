import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { DEFAULT_ANNOTATION_LABELS } from "@paper-viewer/core/labels";
import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";

/**
 * The workspace has no object storage in dev, so the paper is anchored to a
 * `pdfUrl` and the app streams it back through `/api/papers/:id/proxy-pdf`.
 * Serving the fixture from a throwaway local server keeps the run offline and
 * deterministic.
 */
const fixture = readFileSync(join(__dirname, "fixtures", "sample-paper.pdf"));
const password = "annotation-e2e-password";

let pdfServer: Server;
let workspaceId: string;
let userId: string;
let paperId: string;
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
});

test.afterAll(async () => {
  if (paperId) await prisma.paper.delete({ where: { id: paperId } }).catch(() => undefined);
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  await prisma.$disconnect();
  await new Promise<void>((resolve) => pdfServer.close(() => resolve()));
});

test("highlight → label → comment → persists after reload", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/library/);

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

  await expect(page.getByText("1 条")).toBeVisible();
  await expect(page.getByText("interesting")).toBeVisible();
});
