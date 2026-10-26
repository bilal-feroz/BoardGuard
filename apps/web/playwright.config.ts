import { defineConfig } from "@playwright/test";

// Expects the vision API on :8000 and the UI on :3000 (or BASE_URL), e.g. the
// .claude/launch.json servers or `docker run -p 8080:8080` with BASE_URL=http://localhost:8080.
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] },
    trace: "retain-on-failure",
  },
});
