import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";

/**
 * Removing a paper archives it for the whole workspace, so it lives on the paper
 * page rather than on a library row, where it was one mis-aimed click away.
 * Every member may do it — the list is curated by the people reading it — but
 * nobody outside the workspace can, which is what the last test checks.
 */
const password = "paper-remove-e2e-password";

let workspaceId: string;
let ownerId: string;
let memberId: string;
let ownerEmail: string;
let memberEmail: string;
let paperId: string;
let paperTitle: string;
let memberPaperId: string;
let memberPaperTitle: string;
let run: string;

test.beforeAll(async () => {
  run = randomUUID().slice(0, 8);
  ownerEmail = `paper-remove-owner-${run}@example.com`;
  memberEmail = `paper-remove-member-${run}@example.com`;
  paperTitle = `Paper Remove E2E ${run}`;
  memberPaperTitle = `Paper Remove Member E2E ${run}`;

  const owner = await prisma.user.create({
    data: {
      email: ownerEmail,
      name: `Paper Remove Owner ${run}`,
      passwordHash: await bcrypt.hash(password, 10),
      memberships: {
        create: { role: "owner", workspace: { create: { name: `Paper Remove E2E ${run}` } } }
      }
    },
    include: { memberships: true }
  });
  ownerId = owner.id;
  workspaceId = owner.memberships[0]!.workspaceId;

  const member = await prisma.user.create({
    data: {
      email: memberEmail,
      name: `Paper Remove Member ${run}`,
      passwordHash: await bcrypt.hash(password, 10),
      memberships: { create: { role: "member", workspaceId } }
    }
  });
  memberId = member.id;

  const paper = await prisma.paper.create({
    data: {
      title: paperTitle,
      authors: ["Remove Fixture"],
      source: "manual",
      workspacePapers: { create: { workspaceId, importedById: ownerId } }
    }
  });
  paperId = paper.id;

  // The member test removes a paper of its own: two tests archiving the same
  // row would fight when the file's tests run in parallel workers.
  const memberPaper = await prisma.paper.create({
    data: {
      title: memberPaperTitle,
      authors: ["Remove Fixture"],
      source: "manual",
      workspacePapers: { create: { workspaceId, importedById: ownerId } }
    }
  });
  memberPaperId = memberPaper.id;
});

test.afterAll(async () => {
  if (paperId) await prisma.paper.delete({ where: { id: paperId } }).catch(() => undefined);
  if (memberPaperId) await prisma.paper.delete({ where: { id: memberPaperId } }).catch(() => undefined);
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
  if (memberId) await prisma.user.delete({ where: { id: memberId } }).catch(() => undefined);
  if (ownerId) await prisma.user.delete({ where: { id: ownerId } }).catch(() => undefined);
  await prisma.$disconnect();
});

/** Each test re-visibles its paper, so removal order between tests does not matter. */
test.beforeEach(async () => {
  await prisma.workspacePaper.updateMany({
    where: { workspaceId, paperId: { in: [paperId, memberPaperId] } },
    data: { state: "visible" }
  });
});

// The suite runs with a `zh-CN` browser locale (see playwright.config.ts).
async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("邮箱").fill(email);
  await page.getByPlaceholder("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/(today)?$/);
}

test("the library row carries no remove action any more", async ({ page }) => {
  await signIn(page, ownerEmail);
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: paperTitle })).toBeVisible();
  await expect(page.getByRole("button", { name: "从文库移除" })).toHaveCount(0);
});

test("an owner removes the paper from the paper page and it leaves the library", async ({ page }) => {
  await signIn(page, ownerEmail);
  await page.goto(`/papers/${paperId}`);

  await page.getByRole("button", { name: "从文库移除" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "从文库移除" }).click();

  await expect(page).toHaveURL(/\/library/);
  await expect(page.getByRole("heading", { name: paperTitle })).toHaveCount(0);

  const row = await prisma.workspacePaper.findFirst({ where: { workspaceId, paperId } });
  expect(row?.state).toBe("archived");
});

test("a plain member removes a paper too, and an outsider cannot", async ({ page }) => {
  await signIn(page, memberEmail);
  await page.goto(`/papers/${memberPaperId}`);
  await expect(page.getByRole("heading", { name: memberPaperTitle })).toBeVisible();
  await expect(page.getByRole("button", { name: "从文库移除" })).toHaveCount(1);

  const response = await page.request.post(`/api/papers/${memberPaperId}/remove`);
  expect(response.status()).toBe(200);

  const row = await prisma.workspacePaper.findFirst({
    where: { workspaceId, paperId: memberPaperId }
  });
  expect(row?.state).toBe("archived");

  // The workspace scoping is what still guards the endpoint: another
  // workspace's member sees this paper as missing, not as forbidden.
  const outsider = await prisma.user.create({
    data: {
      email: `paper-remove-outsider-${run}@example.com`,
      name: "Outsider",
      passwordHash: await bcrypt.hash(password, 10),
      memberships: {
        create: { role: "owner", workspace: { create: { name: `Paper Remove Outsider ${run}` } } }
      }
    },
    include: { memberships: true }
  });
  try {
    await signIn(page, outsider.email);
    const refused = await page.request.post(`/api/papers/${memberPaperId}/remove`);
    expect(refused.status()).toBe(404);
  } finally {
    await prisma.workspace
      .delete({ where: { id: outsider.memberships[0]!.workspaceId } })
      .catch(() => undefined);
    await prisma.user.delete({ where: { id: outsider.id } }).catch(() => undefined);
  }
});
