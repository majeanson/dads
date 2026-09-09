# dads

A private clubhouse for a small group of dads who already know each other.
Invite code in, talk honestly, and sit at a Jaffre table while you do.

Lives at **dads.marcportal.com**. See [PLAN.md](PLAN.md) for the full plan and
the decisions behind it.

## Stack

Cloudflare Workers + Durable Objects (live room) + D1 (durable state), React +
Vite client, all in one Worker.

## Running it

```bash
npm install
npm run migrate:local      # apply D1 migrations to the local database
npm run group:create -- --slug the-dads --name "The Dads" --night thu:21:00
                           # prints the invite code once; add --remote for production
npm run build              # wrangler serves dist/, so build before dev
npm run dev                # wrangler on :8787 — API, websockets, built assets
npm run dev:web            # vite on :5173 with HMR, proxying to :8787
```

There is no create-a-group button: the door is `group:create`. Dads land on
the root, type the code and a name, and are remembered on that device.

## Checks

```bash
npm run typecheck
npm test                   # worker + DO + D1 against real migrations
npm run e2e                # full stack: built client served by the Worker
npm run lint
```

## Layout

```
src/worker/     Worker entry, router, RoomDO
src/web/        React client
migrations/     D1 schema, applied in tests and in production
test/           vitest, running inside workerd via vitest-plugin
e2e/            Playwright, against the built stack
```
