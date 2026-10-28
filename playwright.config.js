import { defineConfig } from "@playwright/test";

// BASE_URL points the suite at a running stack (e.g. https://site.localhost);
// otherwise it starts the site with cargo.
const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:8080";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL, ignoreHTTPSErrors: true },
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "cargo run --bin mskasal",
        url: "http://127.0.0.1:8080/healthz",
        reuseExistingServer: true,
        timeout: 300_000,
      },
});
