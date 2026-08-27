import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";

/**
 * The team/personal lens. Signed in as the second member, the personal view
 * must narrow every surface to what involves them — their saved papers, their
 * annotations, the comment threads they took part in — and the choice must
 * survive navigation, since it is a cookie the server pages read.
 */
const password = "view-mode-e2e-password";

let workspaceId: string;
let ownerId: string;
let memberId: string;
let memberEmail: string;
let teamPaperId: string;
let minePaperId: string;
let run: string;

function position(pageNumber: number) {
  const rect = { x1: 48, y1: 38, x2: 320, y2: 58, width: 595, height: 792, pageNumber };
  return { boundingRect: rect, rects: [rect], pageNumber, usePdfCoordinates: false };
}

test.beforeAll(async () => {
  run = randomUUID().slice(0, 8);
  memberEmail = `view-mode-member-${run}@example.com`;

  const owner = await prisma.user.create({
    data: {
      email: `view-mode-owner-${run}@example.com`,
      name: `Owner ${run}`,
      passwordHash: await bcrypt.hash(password, 10),
      memberships: {
        create: { role: "owner", workspace: { create: { name: `View Mode E2E ${run}` } } }
      }
    },
    include: { memberships: true }
  });
  ownerId = owner.id;
  workspaceId = owner.memberships[0]!.workspaceId;

  const member = await prisma.user.create({
    data: {
      email: memberEmail,
      name: `Member ${run}`,
      passwordHash: await bcrypt.hash(password, 10),
      memberships: { create: { role: "member", workspaceId } }
    }
  });
  memberId = member.id;

  const teamPaper = await prisma.paper.create({
    data: {
      title: `Team Saved Paper ${run}`,
      authors: ["A"],
      source: "manual",
      workspacePapers: { create: { workspaceId, importedById: ownerId } }
    }
  });
  teamPaperId = teamPaper.id;

  const minePaper = await prisma.paper.create({
    data: {
      title: `Mine Saved Paper ${run}`,
      authors: ["B"],
      source: "manual",
      workspacePapers: { create: { workspaceId, importedById: memberId } }
    }
  });
  minePaperId = minePaper.id;

  await prisma.annotation.create({
    data: {
      workspaceId,
      paperId: teamPaperId,
      authorId: ownerId,
      type: "highlight",
      pageNumber: 1,
      position: position(1),
      quotedText: `owner-quote-${run}`
    }
  });
  await prisma.annotation.create({
    data: {
      workspaceId,
      paperId: teamPaperId,
      authorId: memberId,
      type: "highlight",
      pageNumber: 1,
      position: position(1),
      quotedText: `member-quote-${run}`
    }
  });

  // One discussion thread the member joined, one they never touched.
  const joinedRoot = await prisma.comment.create({
    data: { workspaceId, paperId: teamPaperId, authorId: ownerId, body: `joined-root-${run}` }
  });
  await prisma.comment.create({
    data: {
      workspaceId,
      paperId: teamPaperId,
      authorId: memberId,
      parentId: joinedRoot.id,
      body: `joined-reply-${run}`
    }
  });
  await prisma.comment.create({
    data: { workspaceId, paperId: teamPaperId, authorId: ownerId, body: `untouched-root-${run}` }
  });
});

test.afterAll(async () => {
  for (const paperId of [teamPaperId, minePaperId]) {
    await prisma.paper.delete({ where: { id: paperId } }).catch(() => undefined);
  }
  await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
  for (const id of [ownerId, memberId]) {
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

async function signInAsMember(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("邮箱").fill(memberEmail);
  await page.getByPlaceholder("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/(today)?$/);
}

test("the personal view narrows the library to my saves, and sticks across reloads", async ({
  page
}) => {
  await signInAsMember(page);

  await page.goto("/library");
  await expect(page.getByText(`Team Saved Paper ${run}`)).toBeVisible();
  await expect(page.getByText(`Mine Saved Paper ${run}`)).toBeVisible();

  await page.getByRole("button", { name: "只看我的" }).click();
  await expect(page.getByText(`Team Saved Paper ${run}`)).not.toBeVisible();
  await expect(page.getByText(`Mine Saved Paper ${run}`)).toBeVisible();

  // A cookie, not component state: a fresh load stays personal.
  await page.reload();
  await expect(page.getByText(`Mine Saved Paper ${run}`)).toBeVisible();
  await expect(page.getByText(`Team Saved Paper ${run}`)).not.toBeVisible();
});

test("on a paper it narrows annotations to mine and comments to threads I joined", async ({
  page
}) => {
  await signInAsMember(page);
  await page.goto("/library");
  await page.getByRole("button", { name: "只看我的" }).click();

  // The team paper is reachable by URL even though the personal library hides it.
  await page.goto(`/papers/${teamPaperId}`);

  await page.getByRole("button", { name: "标注" }).click();
  await expect(page.getByText(`member-quote-${run}`)).toBeVisible();
  await expect(page.getByText(`owner-quote-${run}`)).not.toBeVisible();

  await page.getByRole("button", { name: "评论" }).click();
  await expect(page.getByText(`joined-root-${run}`)).toBeVisible();
  await expect(page.getByText(`joined-reply-${run}`)).toBeVisible();
  await expect(page.getByText(`untouched-root-${run}`)).not.toBeVisible();

  // Back to the team view without leaving the paper: everything returns.
  await page.getByRole("button", { name: "全组视角" }).click();
  await expect(page.getByText(`untouched-root-${run}`)).toBeVisible();
  await page.getByRole("button", { name: "标注" }).click();
  await expect(page.getByText(`owner-quote-${run}`)).toBeVisible();
});
