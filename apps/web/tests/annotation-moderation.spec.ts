import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";

/**
 * Annotation moderation follows comments: the author manages their own, and
 * admins/owners may delete anyone's — a highlight marks up shared reading
 * material, so cleaning up after a mistake or a departed member cannot depend
 * on that person still being around. Editing stays author-only: an
 * annotation's labels are the author's reading of the passage.
 */
const password = "annotation-moderation-e2e-password";

let workspaceId: string;
let ownerId: string;
let memberId: string;
let paperId: string;
let ownerEmail: string;
let memberEmail: string;
let ownerAnnotationId: string;
let memberAnnotationId: string;

const POSITION = {
  boundingRect: { x1: 10, y1: 10, x2: 200, y2: 40, width: 800, height: 1000, pageNumber: 1 },
  rects: [{ x1: 10, y1: 10, x2: 200, y2: 40, width: 800, height: 1000, pageNumber: 1 }],
  pageNumber: 1
};

test.beforeAll(async () => {
  const run = randomUUID().slice(0, 8);
  ownerEmail = `annotation-mod-owner-${run}@example.com`;
  memberEmail = `annotation-mod-member-${run}@example.com`;

  const owner = await prisma.user.create({
    data: {
      email: ownerEmail,
      name: `Annotation Mod Owner ${run}`,
      passwordHash: await bcrypt.hash(password, 10),
      memberships: {
        create: { role: "owner", workspace: { create: { name: `Annotation Mod E2E ${run}` } } }
      }
    },
    include: { memberships: true }
  });
  ownerId = owner.id;
  workspaceId = owner.memberships[0]!.workspaceId;

  const member = await prisma.user.create({
    data: {
      email: memberEmail,
      name: `Annotation Mod Member ${run}`,
      passwordHash: await bcrypt.hash(password, 10),
      memberships: { create: { role: "member", workspaceId } }
    }
  });
  memberId = member.id;

  const paper = await prisma.paper.create({
    data: {
      title: `Annotation Mod Fixture ${run}`,
      authors: ["E2E Author"],
      source: "manual",
      abstract: "A fixture abstract.",
      workspacePapers: { create: { workspaceId, importedById: ownerId } }
    }
  });
  paperId = paper.id;

  const [ownerAnnotation, memberAnnotation] = await Promise.all([
    prisma.annotation.create({
      data: {
        workspaceId,
        paperId,
        authorId: ownerId,
        type: "highlight",
        pageNumber: 1,
        quotedText: "owner highlight",
        position: POSITION
      }
    }),
    prisma.annotation.create({
      data: {
        workspaceId,
        paperId,
        authorId: memberId,
        type: "highlight",
        pageNumber: 1,
        quotedText: "member highlight",
        position: POSITION
      }
    })
  ]);
  ownerAnnotationId = ownerAnnotation.id;
  memberAnnotationId = memberAnnotation.id;
});

test.afterAll(async () => {
  if (paperId) await prisma.paper.delete({ where: { id: paperId } }).catch(() => undefined);
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, memberId].filter(Boolean) } } });
  await prisma.$disconnect();
});

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("邮箱").fill(email);
  await page.getByPlaceholder("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/(today)?$/);
}

test("an owner deletes a member's annotation; the member may not touch the owner's", async ({
  page
}) => {
  await signIn(page, memberEmail);
  const memberOnOwner = await page.request.delete(
    `/api/papers/${paperId}/annotations/${ownerAnnotationId}`
  );
  expect(memberOnOwner.status()).toBe(403);
  expect(await prisma.annotation.findUnique({ where: { id: ownerAnnotationId } })).not.toBeNull();

  await signIn(page, ownerEmail);
  const ownerOnMember = await page.request.delete(
    `/api/papers/${paperId}/annotations/${memberAnnotationId}`
  );
  expect(ownerOnMember.status()).toBe(200);
  expect(await prisma.annotation.findUnique({ where: { id: memberAnnotationId } })).toBeNull();
});

test("editing stays author-only, whatever the role", async ({ page }) => {
  await signIn(page, ownerEmail);
  const patch = await page.request.patch(
    `/api/papers/${paperId}/annotations/${ownerAnnotationId}`,
    { data: { labelIds: [] } }
  );
  expect(patch.status()).toBe(200);

  // A second member annotation, so the owner has someone else's to try to edit.
  const theirs = await prisma.annotation.create({
    data: {
      workspaceId,
      paperId,
      authorId: memberId,
      type: "highlight",
      pageNumber: 1,
      quotedText: "member highlight two",
      position: POSITION
    }
  });
  try {
    const foreignPatch = await page.request.patch(
      `/api/papers/${paperId}/annotations/${theirs.id}`,
      { data: { labelIds: [] } }
    );
    expect(foreignPatch.status()).toBe(403);
  } finally {
    await prisma.annotation.delete({ where: { id: theirs.id } }).catch(() => undefined);
  }
});
