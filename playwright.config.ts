import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  use: {
    baseURL: "http://127.0.0.1:3000",
  },

  projects: [
    {
      name: "chromium",
      testMatch: ["selection.spec.ts", "r2-ui-motion.spec.ts"],
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
    {
      name: "node",
      testMatch: "**/*.node.spec.ts",
      use: {},
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
  },
});
