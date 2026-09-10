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
- **Playwright matches accessible names by substring.** `getByRole('button',
{ name: 'Room' })` also matches a prompt ending "...with no phone in the
  room?". Scope to a landmark and pass `exact: true` for short names.
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

## Dad night (M3)

- `src/shared/dadNight.ts` is pure and is the only place instants are computed.
  A slot is `(weekday, "HH:MM", IANA zone)`, never a timestamp, so 21:00 stays
  21:00 across DST. Do not "simplify" it to a stored UTC time.
- The DO has exactly one alarm, so the `schedule` table multiplexes it
  alongside the leave-grace `leaving` table. `rescheduleAlarm()` always arms
  the earliest across both. Anything new that wants a timer goes in `schedule`.
- `night_start` posts "the table's open" and arms `night_end`; `night_end`
  counts the window from the **D1 archive** and posts the summary, then arms
  next week. A group with no night arms nothing.
- Any dad can set the night — no admin role — and the change is announced in
  the room by name. `PUT /api/night` writes D1 then tells the DO, which
  re-arms, announces, and pushes a `night` frame to open sockets.
- Setting a night mid-evening arms that evening's end, so it means something
  immediately instead of waiting a week.

## Prompts (M4)

- The curated 100 live in `migrations/0003_prompt_library.sql` with
  `group_id NULL` (global) and `created_at 0`. **Adding to the library means a
  new migration, never editing that one** — ids are stable and the daily pick
  indexes into an ordered pool.
- The pick is `hash(groupId + day) % poolSize` — deterministic, no coordination.
  It is still written to `prompt_days` and never recomputed, because the pool
  grows when a dad adds a prompt and yesterday's question must not move
  underneath the answers already filed against it.
- The day turns over at the **group's** midnight (`dad_night_tz`), not UTC's.
- An answer is a `messages` row of kind `prompt` carrying `prompt_id`. The DO
  resolves today's prompt itself rather than trusting the client's id.
- The DO's `tail` table gained `prompt_id` via a `PRAGMA table_info` check in
  the constructor. `CREATE TABLE IF NOT EXISTS` does nothing to an existing
  table, so every future DO column needs the same treatment.

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
- **Alarms must be armed at real-future instants.** Faking `Date` does not move
  workerd's alarm scheduler: an alarm armed at a past real time fires
  immediately, re-arms itself off the faked clock, and spins forever. So
  `test/night.test.ts` derives its schedule from the real clock
  (`upcomingNight()`) and fakes `Date` only at the moment it fires the alarm.
  For the same reason, a helper that waits must never reinstall fake timers —
  that silently resets the system time to now.
- Anything that shells out goes through `scripts/run.ts`, which quotes
  arguments on Windows. `execFileSync` with `shell: true` does not.
