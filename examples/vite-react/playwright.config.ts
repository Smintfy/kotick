import { defineConfig, devices } from '@playwright/test';

const port = 5173;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './test',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // The debugger only runs in development builds, so tests run against the dev server.
  // Locally, an already running `pnpm dev` is reused.
  webServer: {
    command: `pnpm exec vite --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !isCI,
  },
});
