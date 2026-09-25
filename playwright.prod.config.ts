import { defineConfig, devices } from '@playwright/test';

/**
 * The suite that runs against the real thing.
 *
 * `npm run e2e` proves the code. This proves the DEPLOYMENT: the custom
 * domain, the assets binding answering before the Worker, the headers that
 * only exist because `public/_headers` shipped, the secrets that are only set
 * in production, and a D1, an R2 and a Durable Object that are not fakes.
 * Every failure here is a thing a dad would have hit, and several of them
 * could not have been caught anywhere else — the endpoint allowlist refusing
 * Chrome's real push host was invisible until somebody drove this.
 *
 * It is NOT in CI and is not part of `npm run e2e`: it needs the live site, a
 * word and a secret that live only on this machine, and it writes into a real
 * room — its own since 2026-09-25 (`prove-room`), not the dads'. One worker,
 * in order, and the teardown sweeps up after it.
 */
const BASE = process.env.PROD_URL ?? 'https://dads.marcportal.com';

export default defineConfig({
  testDir: './prod',
  globalTeardown: './prod/global-teardown.ts',
  // One at a time: there is one room, one roster and one group's state.
  workers: 1,
  fullyParallel: false,
  // The public internet, not a loopback: a retry here is a flaky network, not
  // a flaky assertion.
  retries: 1,
  reporter: 'list',
  timeout: 60_000,
  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
    permissions: ['microphone', 'camera'],
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
