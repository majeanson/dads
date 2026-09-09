/**
 * The Worker's bindings. Generated from wrangler.toml by `wrangler types` into
 * worker-configuration.d.ts, extended with secrets in bindings.d.ts. Re-exported
 * here so application code imports one name and never the generated file.
 */
export type Env = Cloudflare.Env;

const DEV_SECRET = 'dev-only-insecure-secret';

/**
 * Never let a missing secret silently produce forgeable cookies in production.
 * Locally and in tests a fixed value keeps the suite deterministic.
 */
export function sessionSecret(env: Env, isProduction: boolean): string {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (isProduction) throw new Error('SESSION_SECRET is not set');
  return DEV_SECRET;
}
