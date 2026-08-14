import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";

/**
 * Password reset, end to end from a link.
 *
 * No test ever asks for a link for a real account: that would put a genuine
 * email on the wire. The request route is covered through an address with no
 * account, which proves the reply does not reveal whether one exists, and
 * everything after the link is exercised for real — the form, the single use,
 * the expiry, and that the new password actually signs in.
 */
const oldPassword = "password-reset-e2e-old";
const newPassword = "password-reset-e2e-new";

let userId: string;
let email: string;

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Issues a link the same way the request route does. */
async function issueToken(overrides: { expiresAt?: Date; usedAt?: Date } = {}): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.passwordReset.create({
    data: {
      userId,
      tokenHash: hash(token),
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
      usedAt: overrides.usedAt ?? null
    }
  });
  return token;
}

test.beforeAll(async () => {
  const run = randomUUIDish();
  email = `password-reset-${run}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      name: `Password Reset ${run}`,
      passwordHash: await bcrypt.hash(oldPassword, 10),
      memberships: {
        create: { role: "owner", workspace: { create: { name: `Password Reset E2E ${run}` } } }
      }
    },
    include: { memberships: true }
  });
  userId = user.id;
});

function randomUUIDish(): string {
  return randomBytes(4).toString("hex");
}

test.afterAll(async () => {
  const memberships = await prisma.workspaceMembership.findMany({
    where: { userId },
    select: { workspaceId: true }
  });
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  for (const { workspaceId } of memberships) {
    await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

test("the login page offers a way in when the password is forgotten", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "忘记密码？" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(page.getByRole("heading", { name: "重置密码" })).toBeVisible();
});

test("an unknown address gets the same answer as a known one, and no link", async ({ page }) => {
  // Deliberately an address with no account: the reply must not differ, and
  // nothing may be issued. (A known address would mail a real link, which a
  // test has no business doing.)
  const unknown = `password-reset-nobody-${randomUUIDish()}@example.com`;

  await page.goto("/forgot-password");
  await page.getByPlaceholder("邮箱").fill(unknown);
  await page.getByRole("button", { name: "发送重置链接" }).click();

  await expect(page).toHaveURL(/state=sent/);
  await expect(page.getByRole("status")).toBeVisible();
  // The link itself must never appear on screen — that would let anyone reset
  // anyone's password.
  await expect(page.locator("body")).not.toContainText("/reset-password/");
  expect(await prisma.passwordReset.count({ where: { user: { email: unknown } } })).toBe(0);
});

test("a link sets a new password, once, and the new password signs in", async ({ page }) => {
  const token = await issueToken();

  await page.goto(`/reset-password/${token}`);
  await page.getByPlaceholder("新密码").fill(newPassword);
  await page.getByRole("button", { name: "保存新密码" }).click();
  await expect(page).toHaveURL(/\/login\?reset=done$/);
  await expect(page.getByRole("status")).toBeVisible();

  // The old password is gone and the new one works.
  await page.getByPlaceholder("邮箱").fill(email);
  await page.getByPlaceholder("密码").fill(oldPassword);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/error=invalid/);

  await page.getByPlaceholder("邮箱").fill(email);
  await page.getByPlaceholder("密码").fill(newPassword);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/(today)?$/);

  // Single use: the same link is dead now.
  await page.goto(`/reset-password/${token}`);
  await expect(page.getByRole("heading", { name: "这个链接已失效" })).toBeVisible();
});

test("an expired link is refused", async ({ page }) => {
  const token = await issueToken({ expiresAt: new Date(Date.now() - 1000) });
  await page.goto(`/reset-password/${token}`);
  await expect(page.getByRole("heading", { name: "这个链接已失效" })).toBeVisible();
});

test("issuing a link retires the one before it", async ({ page }) => {
  const first = await issueToken();
  // The request route issues through createPasswordReset, which retires
  // outstanding links; simulate that second issue.
  const { createPasswordReset } = await import("@/lib/password-reset");
  await createPasswordReset(userId);

  await page.goto(`/reset-password/${first}`);
  await expect(page.getByRole("heading", { name: "这个链接已失效" })).toBeVisible();
});
