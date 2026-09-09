/// <reference types="@cloudflare/vitest-plugin/types" />

// Test-only binding, injected by vitest.config.ts so test/apply-migrations.ts
// can build the schema before the suite runs.
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
