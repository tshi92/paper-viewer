import { expect, test } from "@playwright/test";

test("library redirects unauthenticated users to login", async ({ page }) => {
  await page.goto("/library");
  await expect(page).toHaveURL(/\/login/);
});
