// Applies the D1 migrations to the miniflare-faked test database before the
// suite runs. TEST_MIGRATIONS is injected by vitest.config.ts.
import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
