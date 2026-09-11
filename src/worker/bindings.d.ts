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

    /**
     * VAPID keypair for dad-night reminders. Optional, exactly like TURN:
     * without them /api/push answers 503, the client never offers the toggle,
     * and nothing else changes.
     *   npm run vapid
     *   wrangler secret put VAPID_PUBLIC_KEY
     *   wrangler secret put VAPID_PRIVATE_KEY
     */
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;

    /**
     * Lets a line be taken back out of the room, archive and tail together.
     *
     * Optional, like everything else here, and absent by default: without it
     * /api/ops/forget does not exist. It is set in production so that the
     * suite which runs against the live room can sweep up after itself — and
     * because five friends will eventually post something they wish they had
     * not.
     *   wrangler secret put OPS_SECRET
     */
    OPS_SECRET?: string;
  }
}
