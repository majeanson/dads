import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';

/**
 * One Durable Object per group. Owns the LIVE half of the room: who is
 * connected, the chat fan-out, typing, and the relayed Jaffre table events.
 * Anything that must outlive an eviction goes to D1 instead (see migrations).
 *
 * M0: the shell only — construction, a health probe, and the websocket upgrade
 * point that M2 fills in. It exists now so the DO binding, the SQLite class
 * migration and the test harness are proven before any behaviour depends on
 * them.
 */
export class RoomDO extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ ok: true, id: this.ctx.id.toString() });
    }

    if (request.headers.get('Upgrade') === 'websocket') {
      // M2 wires hibernatable websockets here.
      return new Response('not implemented', { status: 501 });
    }

    return new Response('not found', { status: 404 });
  }
}
