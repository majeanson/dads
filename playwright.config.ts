import { defineConfig, devices } from '@playwright/test';

const PORT = 8788;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // The whole stack, the way it ships: built client served by the Worker,
    // with a local D1. Testing the Vite dev server instead would prove nothing
    // about the assets binding or the run_worker_first routing.
    command: `npm run build && npx wrangler dev --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    // Never adopt a server this run did not start: a leftover process from an
    // interrupted run can be serving stale code, and a silently reused one is
    // worse than a failed start.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
