/**
 * The Worker's bindings. Generated from wrangler.toml by `wrangler types` into
 * worker-configuration.d.ts, extended with secrets in bindings.d.ts. Re-exported
 * here so application code imports one name and never the generated file.
 */
export type Env = Cloudflare.Env;

const DEV_SECRET = 'dev-only-insecure-secret';

/**
 * TEMPORARY: is the door unlocked?
 *
 * One var in wrangler.toml, read in exactly one place, so locking it again is
 * deleting a line rather than unpicking a change that spread. While it is off,
 * nothing about the invite code has changed: it is still PBKDF2'd at rest and
 * still verified on the way in.
 */
export function doorIsOpen(env: Env): boolean {
  return env.OPEN_DOOR === 'yes';
}

/**
 * Never let a missing secret silently produce forgeable cookies in production.
 * Locally and in tests a fixed value keeps the suite deterministic.
 */
export function sessionSecret(env: Env, isProduction: boolean): string {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (isProduction) throw new Error('SESSION_SECRET is not set');
  return DEV_SECRET;
}
