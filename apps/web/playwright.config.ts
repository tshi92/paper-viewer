import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  use: {
    baseURL: "http://127.0.0.1:3000",
    // The UI is translated and the locale resolver falls back to `Accept-Language`
    // when no `NEXT_LOCALE` cookie is set. Headless Chrome would otherwise ask for
    // `en-US`, so specs that assert Chinese copy would flip language with the
    // machine's browser defaults. Pinning the context locale makes the whole suite
    // deterministically Chinese; auth.spec opts back into English on its own.
    locale: "zh-CN",
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true
  }
});
