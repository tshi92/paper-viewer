import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";

/**
 * Accepting an invitation — the one screen a person meets before they have an
 * account, so every refusal has to come back to it with a reason rather than
 * ending at a status code.
 */
const password = "invite-e2e-password";

let workspaceId: string;
let ownerId: string;
let run: string;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Issues a link the same way the invitations route does. */
async function issue(email: string, expiresAt: Date): Promise<string> {
  const token = randomUUID() + randomUUID();
  await prisma.invitation.create({
    data: { workspaceId, email, role: "member", tokenHash: hashToken(token), expiresAt }
  });
  return token;
}

function inSevenDays(): Date {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

test.beforeAll(async () => {
  run = randomUUID().slice(0, 8);
  const owner = await prisma.user.create({
    data: {
      email: `invite-owner-${run}@example.com`,
      name: `Owner ${run}`,
      passwordHash: await bcrypt.hash(password, 10),
      memberships: {
        create: { role: "owner", workspace: { create: { name: `Invite E2E ${run}` } } }
      }
    },
    include: { memberships: true }
  });
  ownerId = owner.id;
  workspaceId = owner.memberships[0]!.workspaceId;
});

test.afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: `invite-e2e-${run}` } } });
  await prisma.user.delete({ where: { id: ownerId } }).catch(() => undefined);
  await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
  await prisma.$disconnect();
});

async function fill(
  page: Page,
  fields: { name: string; password: string; confirm: string }
): Promise<void> {
  await page.getByLabel("显示名称").fill(fields.name);
  await page.getByLabel("密码", { exact: true }).fill(fields.password);
  await page.getByLabel("确认密码").fill(fields.confirm);
}

test("names the workspace and shows the address the account will use", async ({ page }) => {
  const email = `invite-e2e-${run}-shown@example.com`;
  await page.goto(`/invite/${await issue(email, inSevenDays())}`);

  await expect(page.getByRole("heading")).toContainText(`Invite E2E ${run}`);
  await expect(page.getByRole("heading")).toContainText("Paper Viewer");
  // Shown, never offered: the address is not the invitee's to change.
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "登录邮箱" })).toHaveCount(0);
});

test("a spent or expired link says so instead of showing a form", async ({ page }) => {
  await page.goto(`/invite/${await issue(`invite-e2e-${run}-old@example.com`, new Date(Date.now() - 1000))}`);

  await expect(page.getByRole("heading", { name: "这个邀请链接已失效" })).toBeVisible();
  await expect(page.getByLabel("显示名称")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "返回登录" })).toBeVisible();
});

test("a mismatched confirmation is refused and creates nothing", async ({ page }) => {
  const email = `invite-e2e-${run}-mismatch@example.com`;
  await page.goto(`/invite/${await issue(email, inSevenDays())}`);

  await fill(page, { name: "Mismatch", password: "long-enough-1", confirm: "long-enough-2" });
  await page.getByRole("button", { name: "加入工作区" }).click();

  await expect(page.getByRole("alert")).toContainText("两次输入的密码不一致");
  expect(await prisma.user.count({ where: { email } })).toBe(0);
});

test("a password under the floor is refused by the server, not just the browser", async ({
  page
}) => {
  const email = `invite-e2e-${run}-short@example.com`;
  await page.goto(`/invite/${await issue(email, inSevenDays())}`);

  // Strip the client-side guard: what matters is that the server has one too.
  await page.evaluate(() => {
    document.querySelectorAll("input[type=password]").forEach((input) => {
      input.removeAttribute("minLength");
    });
  });
  await fill(page, { name: "Short", password: "short", confirm: "short" });
  await page.getByRole("button", { name: "加入工作区" }).click();

  await expect(page.getByRole("alert")).toContainText("至少 8 位");
  expect(await prisma.user.count({ where: { email } })).toBe(0);
});

test("a good submission creates the member and signs them in", async ({ page }) => {
  const email = `invite-e2e-${run}-ok@example.com`;
  await page.goto(`/invite/${await issue(email, inSevenDays())}`);

  await fill(page, { name: `New Member ${run}`, password: "8charsok", confirm: "8charsok" });
  await page.getByRole("button", { name: "加入工作区" }).click();

  // Signed in, landed inside the app.
  await expect(page).toHaveURL(/\/(today)?$/);

  const created = await prisma.user.findUnique({
    where: { email },
    include: { memberships: true }
  });
  expect(created?.name).toBe(`New Member ${run}`);
  expect(created?.memberships[0]?.workspaceId).toBe(workspaceId);

  // Single use: the link is dead now.
  const invitation = await prisma.invitation.findFirst({ where: { email } });
  expect(invitation?.acceptedAt).not.toBeNull();
});
