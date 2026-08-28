import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";

/**
 * The members page is two independent cards side by side. It used to be one
 * stretched grid row, so the invite form grew an ever larger hole inside itself
 * as the workspace gained members.
 */
const password = "members-page-e2e-password";
const MEMBER_COUNT = 6;

let workspaceId: string;
let ownerId: string;
let ownerEmail: string;
let selfNamedEmail: string;
let namedEmail: string;
const memberIds: string[] = [];
let run: string;

test.beforeAll(async () => {
  run = randomUUID().slice(0, 8);
  ownerEmail = `members-owner-${run}@example.com`;
  // Someone who typed their own address into the display name field.
  selfNamedEmail = `members-selfnamed-${run}@example.com`;
  namedEmail = `members-named-${run}@example.com`;

  const owner = await prisma.user.create({
    data: {
      email: ownerEmail,
      name: `Members Owner ${run}`,
      passwordHash: await bcrypt.hash(password, 10),
      memberships: {
        create: { role: "owner", workspace: { create: { name: `Members Page E2E ${run}` } } }
      }
    },
    include: { memberships: true }
  });
  ownerId = owner.id;
  workspaceId = owner.memberships[0]!.workspaceId;

  for (const [email, name] of [
    [selfNamedEmail, selfNamedEmail],
    [namedEmail, `Named Member ${run}`],
    // Enough further rows that the list is clearly the taller of the two cards.
    ...Array.from({ length: MEMBER_COUNT }, (_, i) => [
      `members-filler-${i}-${run}@example.com`,
      `Filler ${i} ${run}`
    ])
  ] as [string, string][]) {
    const member = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash: await bcrypt.hash(password, 10),
        memberships: { create: { role: "member", workspaceId } }
      }
    });
    memberIds.push(member.id);
  }
});

test.afterAll(async () => {
  if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
  for (const id of memberIds) await prisma.user.delete({ where: { id } }).catch(() => undefined);
  if (ownerId) await prisma.user.delete({ where: { id: ownerId } }).catch(() => undefined);
  await prisma.$disconnect();
});

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("邮箱").fill(ownerEmail);
  await page.getByPlaceholder("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/(today)?$/);
}

test("the invite form sizes to its own content instead of the member list", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings/members");
  // Wide enough for the two-column layout; the single-column stack below `lg`
  // has nothing to stretch against.
  await page.setViewportSize({ width: 1440, height: 900 });

  const form = page.locator("form[action='/api/members/invitations']");
  // The member and invitation cards are the form's sibling column.
  const list = page.locator("form[action='/api/members/invitations'] + section");
  await expect(form).toBeVisible();

  const formBox = (await form.boundingBox())!;
  const listBox = (await list.boundingBox())!;
  // Stretched to a common height these were equal; sized to content the form is
  // a fraction of a list this long.
  expect(formBox.height).toBeLessThan(listBox.height);
});

test("a member who used their address as a display name is not printed twice", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings/members");

  // Counted over the card's rendered text rather than by locator: the address
  // was printed twice inside ONE row, and a locator matching the inner span
  // finds exactly one either way.
  const card = page.locator("form[action='/api/members/invitations'] + section > div").first();
  const rendered = await card.innerText();
  const occurrencesOf = (value: string) => rendered.split(value).length - 1;

  expect(occurrencesOf(selfNamedEmail)).toBe(1);
  // A real display name still shows alongside the address: name once, address
  // once.
  expect(occurrencesOf(`Named Member ${run}`)).toBe(1);
  expect(occurrencesOf(namedEmail)).toBe(1);
});
