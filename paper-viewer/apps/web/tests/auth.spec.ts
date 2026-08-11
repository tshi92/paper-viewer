import { expect, test } from "@playwright/test";

// The suite is pinned to Chinese in playwright.config.ts; this spec asserts the
// English copy, so it opts back into an English browser locale for its own context.
test.use({ locale: "en-US" });

test("login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
