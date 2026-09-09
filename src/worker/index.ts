import type { Env } from './env';
import { join, leave, me } from './routes/auth';

export { RoomDO } from './RoomDO';

/**
 * Worker entry. Routes split three ways:
 *   /api/*  — JSON endpoints backed by D1
 *   /ws/*   — websocket upgrade, forwarded to the group's RoomDO
 *   *       — static assets / SPA shell (handled by the [assets] binding,
 *             which only sees the request because run_worker_first excludes it)
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url);
    }

    if (url.pathname.startsWith('/ws/')) {
      return handleWs(request, env, url);
    }

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
  }

  return Response.json({ error: 'not_found' }, { status: 404 });
}

async function handleWs(request: Request, env: Env, url: URL): Promise<Response> {
  // /ws/:groupSlug
  const slug = url.pathname.slice('/ws/'.length);
  if (!slug) return new Response('missing group', { status: 400 });

  // idFromName keyed on the slug: one DO per group, stable across deploys.
  const stub = env.ROOM.get(env.ROOM.idFromName(slug));
  return stub.fetch(request);
}
