import type { Env } from '../env';

/**
 * ICE servers for the voice mesh.
 *
 * STUN is unconditional; TURN is a bonus. Any failure reaching Cloudflare
 * Realtime degrades to STUN-only rather than erroring — most dads on ordinary
 * home connections never need a relay, and the ones who do should be the only
 * ones a TURN outage affects.
 *
 * Same shape as jaffre's, deliberately: it is a solved problem and the two
 * apps sit on the same account.
 */
export async function getIce(env: Env): Promise<Response> {
  const iceServers: unknown[] = [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
  ];

  if (env.TURN_KEY_ID !== undefined && env.TURN_KEY_API_TOKEN !== undefined) {
    try {
      const res = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ttl: 6 * 3600 }),
        },
      );
      if (res.ok) {
        const data = (await res.json()) as { iceServers?: unknown };
        if (Array.isArray(data.iceServers)) iceServers.push(...(data.iceServers as unknown[]));
        else if (data.iceServers !== undefined) iceServers.push(data.iceServers);
      }
    } catch {
      // STUN-only fallback, on purpose.
    }
  }

  return Response.json({ iceServers }, { headers: { 'Cache-Control': 'no-store' } });
}
