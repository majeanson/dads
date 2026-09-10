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

    /**
     * Cloudflare Realtime TURN key, for voice across strict NATs. Optional:
     * without them the mesh runs STUN-only, which is enough for most home
     * connections. Create a key at dash.cloudflare.com → Realtime → TURN:
     *   wrangler secret put TURN_KEY_ID
     *   wrangler secret put TURN_KEY_API_TOKEN
     */
    TURN_KEY_ID?: string;
    TURN_KEY_API_TOKEN?: string;
  }
}
