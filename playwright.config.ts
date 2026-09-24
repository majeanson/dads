import { defineConfig, devices } from '@playwright/test';

const PORT = 8788;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  // Two browsers against one local workerd is plenty; five at once ran the
  // Node side out of heap on a first attempt and left the server orphaned.
  workers: process.env.CI ? 1 : 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /safari.spec.ts/,
      use: {
        ...devices['Desktop Chrome'],
        // Fake devices, granted up front: the call is a real WebRTC mesh and
        // there is no microphone on CI. Chrome generates a tone and a moving
        // pattern. Chrome's own flags, so they live on Chrome's project.
        permissions: ['microphone', 'camera'],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
      },
    },
    {
      // The dads on iPhones. Only the phone-shaped spec, in a room of its own,
      // so nothing it does lands in a Chromium spec's roster.
      name: 'webkit-iphone',
      testMatch: /safari.spec.ts/,
      use: { ...devices['iPhone 13'] },
    },
  ],
  webServer: {
    // The whole stack, the way it ships: built client served by the Worker,
    // with a local D1. Testing the Vite dev server instead would prove nothing
    // about the assets binding or the run_worker_first routing.
    // ENVIRONMENT overridden: wrangler.toml declares production, and in production
    // a missing SESSION_SECRET is fatal by design. The e2e stack is not production.
    command: `npm run build && npx wrangler dev --port ${PORT} --var ENVIRONMENT:development`,
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
