// Bindings that `wrangler types` cannot see, merged into the generated
// Cloudflare.Env (worker-configuration.d.ts) so there is exactly one Env type.
declare namespace Cloudflare {
  interface Env {
    /**
     * HMAC key for the identity cookie and for hashing device tokens.
     * `wrangler secret put SESSION_SECRET` in production, `.dev.vars` locally.
     * Optional in the type because it is genuinely absent locally and in
     * tests — sessionSecret() is where that is handled.
     */
    SESSION_SECRET?: string;
  }
}
