import { expect, test } from "@playwright/test";

// The suite is pinned to Chinese in playwright.config.ts; this spec asserts the
// English copy, so it opts back into an English browser locale for its own context.
test.use({ locale: "en-US" });

test("login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("a failed login lands back on the form with a visible error", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill("nobody@example.com");
  await page.getByPlaceholder("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/login\?error=/);
  await expect(page.getByRole("alert")).toContainText("Incorrect email or password");
});
