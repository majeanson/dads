import type { Env } from './env';
import { IDENTITY_HEADERS } from './RoomDO';
import { currentSession, join, leave, me } from './routes/auth';
import { getBoard, putCheckIn, putCommitment, putCommitmentOutcome } from './routes/board';
import { getNightIcs } from './routes/calendar';
import { getIce } from './routes/ice';
import { createInvite } from './routes/invite';
import { getTodo } from './routes/todo';
import { getMedia, listMedia, uploadMedia } from './routes/media';
import { setNight } from './routes/night';
import { getPresence } from './routes/presence';
import { getPushKey, subscribePush, unsubscribePush } from './routes/push';
import { addNightItem, getRsvps, putRsvp, removeNightItem } from './routes/rsvp';
import { putRooms } from './routes/rooms';
import { getTable } from './routes/table';
import { addPrompt, getPromptAnswers, getTodaysPrompt, listPrompts } from './routes/prompts';

export { RoomDO } from './RoomDO';

/**
 * Worker entry. Routes split three ways:
 *   /api/*  — JSON endpoints backed by D1
 *   /ws/*   — websocket upgrade, forwarded to the group's RoomDO
 *   *       — static assets / SPA shell (handled by the [assets] binding,
 *             which only sees the request because run_worker_first excludes it)
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url);
    }

    if (url.pathname === '/ws' || url.pathname.startsWith('/ws/')) {
      return handleWs(request, env, url, ctx);
    }

    // Headers for these come from public/_headers: the assets binding answers
    // before this Worker runs, so they cannot be set here.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

/**
 * Production is declared by a var in wrangler.toml, never inferred from the
 * hostname: a preview deployment on workers.dev is not production, and the
 * difference decides whether a missing SESSION_SECRET is fatal and whether the
 * identity cookie is marked Secure.
 */
function isProduction(env: Env): boolean {
  return env.ENVIRONMENT === 'production';
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const prod = isProduction(env);
  const route = `${request.method} ${url.pathname}`;

  switch (route) {
    // Liveness AND readiness: a Worker that boots but cannot reach D1 is not
    // healthy in any sense that matters, and finding that out from a deploy
    // check beats finding it out from a dad who cannot join.
    case 'GET /api/health': {
      try {
        await env.DB.prepare('SELECT 1').first();
      } catch (err) {
        console.error('health: D1 unreachable', err);
        return Response.json({ ok: false, db: false }, { status: 503 });
      }
      return Response.json({ ok: true, db: true });
    }

    case 'POST /api/join':
      return join(request, env, prod);

    case 'GET /api/me':
      return me(request, env, prod);

    case 'POST /api/leave':
      return leave(prod);

    case 'POST /api/invite':
      return createInvite(request, env, prod);

    case 'PUT /api/rooms':
      return putRooms(request, env, prod);

    case 'PUT /api/night':
      return setNight(request, env, prod);

    case 'GET /api/night':
      return getRsvps(request, env, prod);

    case 'PUT /api/rsvp':
      return putRsvp(request, env, prod);

    case 'POST /api/night-item':
      return addNightItem(request, env, prod);

    case 'DELETE /api/night-item':
      return removeNightItem(request, env, url, prod);

    case 'GET /api/night.ics':
      return getNightIcs(request, env, prod);

    case 'GET /api/presence':
      return getPresence(request, env, prod);

    case 'GET /api/push':
      return getPushKey(request, env, url, prod);

    case 'POST /api/push':
      return subscribePush(request, env, prod);

    case 'DELETE /api/push':
      return unsubscribePush(request, env, prod);

    case 'GET /api/board':
      return getBoard(request, env, prod);

    case 'PUT /api/check-in':
      return putCheckIn(request, env, prod);

    case 'PUT /api/commitment':
      return putCommitment(request, env, prod);

    case 'PUT /api/commitment-outcome':
      return putCommitmentOutcome(request, env, prod);

    case 'POST /api/media':
      return uploadMedia(request, env, prod);

    case 'GET /api/media':
      return getMedia(request, env, url, prod);

    case 'GET /api/media-list':
      return listMedia(request, env, prod);

    case 'GET /api/todo':
      return getTodo(request, env, prod);

    case 'GET /api/ice':
      return getIce(request, env, prod);

    case 'GET /api/table':
      return getTable(request, env, prod);

    case 'GET /api/prompt':
      return getTodaysPrompt(request, env, prod);

    case 'GET /api/prompts':
      return listPrompts(request, env, prod);

    case 'POST /api/prompts':
      return addPrompt(request, env, prod);

    case 'GET /api/prompt-answers':
      return getPromptAnswers(request, env, url, prod);
  }

  return Response.json({ error: 'not_found' }, { status: 404 });
}

/**
 * /ws — the cookie decides the room, not the URL. A dad cannot pick a group
 * he is not a member of by editing an address, and there is nothing in the
 * address to get wrong.
 */
async function handleWs(
  request: Request,
  env: Env,
  url: URL,
  ctx: ExecutionContext,
): Promise<Response> {
  if (url.pathname !== '/ws') return new Response('not found', { status: 404 });
  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('expected websocket', { status: 426 });
  }

  const session = await currentSession(request, env, isProduction(env));
  if (!session) return new Response('unauthorized', { status: 401 });

  ctx.waitUntil(
    env.DB.prepare('UPDATE members SET last_seen = ? WHERE id = ?')
      .bind(Date.now(), session.member.id)
      .run(),
  );

  // Identity travels as headers the DO trusts, because only this Worker can
  // reach it. The cookie itself is stripped: the DO has no use for it.
  const headers = new Headers(request.headers);
  headers.delete('Cookie');
  headers.set(IDENTITY_HEADERS.groupId, session.group.id);
  headers.set(IDENTITY_HEADERS.memberId, session.member.id);
  headers.set(IDENTITY_HEADERS.name, session.member.displayName);
  if (session.group.dadNight) {
    headers.set(IDENTITY_HEADERS.night, JSON.stringify(session.group.dadNight));
  }

  // Keyed on the group id, not the slug: renaming a group must not move its
  // room.
  const stub = env.ROOM.get(env.ROOM.idFromName(session.group.id));
  return stub.fetch(new Request(request, { headers }));
}
