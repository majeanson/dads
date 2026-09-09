# dads — working notes

Read [PLAN.md](PLAN.md) first. It holds the locked decisions and the milestone
list; do not relitigate a decision recorded there without asking.

## Rules

- **This repo only.** `~/Documents/WebApp` is a separate parent repo. Never
  commit or push anything outside `dads/`.
- **DO for live, D1 for durable.** Presence, chat fan-out, typing and relayed
  table events live in `RoomDO`. Anything that must survive an eviction —
  check-ins, commitments, prompts, message archive — goes to D1. If you find
  yourself persisting long-lived records in DO storage, that is the wrong side.
- **Multi-group from day one.** Every query is keyed by `group_id`. v1 shows one
  group; adding a second must never require a migration.
- **Tests run against the real schema.** `vitest.config.ts` reads
  `migrations/` and applies it to the faked D1. A migration that does not apply
  fails the suite.
- **Behavioural e2e only.** Playwright asserts what a dad can do, not what a
  pixel looks like. The design pass is M7; until then, no UI-detail assertions.
- **Never leave a dev server orphaned.** On Windows, killing the shell does not
  kill child node processes. Let `npm run e2e` finish or stop it explicitly.
  `reuseExistingServer` is off on purpose — do not turn it on, and do not add a
  script that kills whatever holds the port.
- **No life-as-code here.** This repo is a plain repo by decision.

## Secrets and environment

`SESSION_SECRET` signs the identity cookie and hashes device tokens.
`wrangler secret put SESSION_SECRET` in production, `.dev.vars` locally.
`sessionSecret()` throws rather than falling back to the dev value in
production.

"Production" is `ENVIRONMENT = "production"` in `wrangler.toml`, never the
hostname. `wrangler dev` reads that same file, so `npm run dev` and the e2e
webServer pass `--var ENVIRONMENT:development`. If a local run 500s with
"SESSION_SECRET is not set", that override is missing — do not fix it by
weakening `sessionSecret()`.

## Identity model

- One invite code per group, PBKDF2-hashed with a per-group salt. Codes are
  normalized (case, whitespace) before hashing; never compare them raw.
- The signed cookie names `{groupId, memberId}`. A device token in
  localStorage, HMAC-hashed in `members.device_token_hash`, lets a returning
  browser rejoin as the same member if the cookie is gone.
- Failed joins are throttled per IP in `join_attempts` (10 per 10 minutes).
  A success clears the bucket. Only the IP's HMAC is stored.
- `scripts/create-group.ts` is the only way a group comes to exist.

## The room (M2)

- `/ws` takes the group from the **cookie**, never the URL. The Worker
  resolves the session, strips the cookie, and forwards identity in
  `X-Dads-*` headers that the DO trusts because only the Worker can reach it.
  The DO is keyed on `group.id`, so renaming a group does not move its room.
- The DO keeps a capped `tail` (500 rows) in its own SQLite for backfill, and
  writes every line to D1 `messages` as the uncapped archive. Fan-out happens
  **before** the archive write — a dad never waits on D1 to see his own line.
- Clients reconnect with `?after=<last seq>` and get only what they missed.
  `seq` is the DO's autoincrement and is the dedupe key on the client.
- Leaving is on a 15s grace timer backed by one alarm (`leaving` table), so a
  phone switching wifi→LTE does not print "left"/"came in". Returning inside
  the window cancels the row _and_ reschedules the alarm.
- Ping/pong is `setWebSocketAutoResponse`, which never wakes a hibernating
  object. Do not replace it with a handled message.

## Test layout

- vitest storage is per **file**, not per test. Tests that seed groups call
  `resetTables()` in `beforeEach`; seeded codes are unique by default.
- e2e `global-setup.ts` migrates the local D1, then drops and recreates one
  group **per spec file** with a known code. They cannot share: a roster is
  global to its group, so a dad from another file would show up in a
  "2 here" assertion. Tests within a file that share a group are `serial`.
  On Windows it verifies migrations via `migrations list` because wrangler has
  crashed in teardown after a successful apply.
- DO alarm tests fake only `Date` (`vi.useFakeTimers({ toFake: ['Date'] })`).
  The DO shares the test isolate, so this moves its clock too; faking timers
  wholesale would hang the frame-wait helpers.
- Anything that shells out goes through `scripts/run.ts`, which quotes
  arguments on Windows. `execFileSync` with `shell: true` does not.
