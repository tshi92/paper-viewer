import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

/**
 * Changing your own password from Settings → General.
 *
 * Until this existed there was no way to change a password while signed in at
 * all: passwordHash was written only when an account was created and by the
 * reset-by-email flow, so a deployment with no mail provider had no path.
 *
 * These run in order and the last one really does change the password, so
 * every sign-in below states which password it is using.
 */
const originalPassword = "change-password-e2e-original";
const shortPassword = "short";
const nextPassword = "change-password-e2e-next";

let userId: string;
let email: string;

test.beforeAll(async () => {
  const run = randomUUID().slice(0, 8);
  email = `change-password-e2e-${run}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      name: `Change Password ${run}`,
      passwordHash: await bcrypt.hash(originalPassword, 10),
      memberships: {
        create: { role: "owner", workspace: { create: { name: `Change Password E2E ${run}` } } }
      }
    }
  });
  userId = user.id;
});

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

async function signIn(page: Page, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("邮箱").fill(email);
  await page.getByPlaceholder("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/(today)?$/);
}

async function submitChange(
  page: Page,
  fields: { current: string; next: string; confirm?: string }
): Promise<void> {
  await page.goto("/settings/general");
  await page.getByLabel("当前密码").fill(fields.current);
  await page.getByLabel("新密码", { exact: true }).fill(fields.next);
  await page.getByLabel("确认新密码").fill(fields.confirm ?? fields.next);
  await page.getByTestId("password-save").click();
}

test("a wrong current password is refused and the old one still signs in", async ({ page }) => {
  await signIn(page, originalPassword);
  await submitChange(page, { current: "not-the-current-password", next: nextPassword });

  await expect(page.getByTestId("password-save-result")).toHaveText(/当前密码不正确/);

  // The account is untouched: the original password still works.
  await signIn(page, originalPassword);
});

test("a new password under the minimum is refused", async ({ page }) => {
  await signIn(page, originalPassword);
  await submitChange(page, { current: originalPassword, next: shortPassword });

  // Built from the policy rather than written out: the copy carries the
  // number, so a hardcoded one here breaks the moment the floor moves.
  await expect(page.getByTestId("password-save-result")).toHaveText(
    new RegExp(`至少 ${MIN_PASSWORD_LENGTH} 位`)
  );
  await signIn(page, originalPassword);
});

test("a confirmation that does not match is refused before anything is sent", async ({ page }) => {
  await signIn(page, originalPassword);
  await submitChange(page, {
    current: originalPassword,
    next: nextPassword,
    confirm: `${nextPassword}-typo`
  });

  await expect(page.getByTestId("password-save-result")).toHaveText(/两次输入不一致/);
  await signIn(page, originalPassword);
});

test("reusing the current password as the new one is refused", async ({ page }) => {
  await signIn(page, originalPassword);
  await submitChange(page, { current: originalPassword, next: originalPassword });

  await expect(page.getByTestId("password-save-result")).toHaveText(/不能与当前密码相同/);
  await signIn(page, originalPassword);
});

// Last: this one really changes the password.
test("the change takes: the old password stops working and the new one signs in", async ({
  page
}) => {
  await signIn(page, originalPassword);
  await submitChange(page, { current: originalPassword, next: nextPassword });

  await expect(page.getByTestId("password-save-result")).toHaveText(/已修改/);

  // Still signed in on this device — the change must not sign the changer out.
  await page.goto("/today");
  await expect(page).toHaveURL(/\/today$/);

  await page.goto("/login");
  await page.getByPlaceholder("邮箱").fill(email);
  await page.getByPlaceholder("密码").fill(originalPassword);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/error=invalid/);

  await signIn(page, nextPassword);
});
