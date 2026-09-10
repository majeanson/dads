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
- **A control needs a real bounding box.** A visually-hidden radio styled
  `width:0;height:0` has no hit area of its own and is invisible to anything
  driving the page. Fill the label with `position:absolute;inset:0;opacity:0`
  instead.
- **A fresh browser context is a fresh dad.** e2e identity lives in a cookie
  plus localStorage, so `browser.newContext()` creates a new member even with
  the same name. Give each test its own names.
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

## The board (M5)

- `src/shared/week.ts` is pure ISO-8601 week numbering, computed in the
  **group's** zone. ISO rules are not the obvious ones: weeks start Monday and
  week 1 holds the first Thursday, so early January often belongs to the
  previous year and some years have 53 weeks. Do not replace it with
  "day of year / 7".
- Check-ins and commitments are one per dad per week, upserted on the
  `(group_id, member_id, week)` unique index. Changing a commitment mid-week
  resets its outcome — a new promise has not been kept yet.
- Everything on the board is **group-visible by design**, including your own
  row, which renders in the list as well as in the editor. Every member gets a
  row whether or not he filled it in; a board that only shows the dads who
  turned up is a board that flatters.
- `pending` scans back through the shown weeks, not just the one behind, so a
  fortnight away does not lose the question. A dad can only close his own
  commitment — the update is keyed on his member id.
- Writes announce themselves in the room via the DO's `/announce` endpoint.
  The board holds the detail; the room line is what makes anyone look.

## The table (M6)

- Jaffre is framed cross-origin. A spike proved it works: jaffre sets no
  `X-Frame-Options` and no CSP, has **no cookies at all** (identity is an
  HMAC token in localStorage, the game socket authenticates with `?t=`), and
  `localStorage` survives partitioning. So there is no cookie dependency to
  break.
- The embed URL goes to `/?name=…&from=dads#room/<code>`, **never**
  `/join/<code>`: that route rewrites the URL and drops the query with it.
- `groups.jaffre_room_code` is minted from the slug on first use then read
  back forever. Deriving it every time would mean a renamed group silently
  walks into an empty room.
- `event.origin !== JAFFRE_ORIGIN` is the whole security boundary on the way
  in — any page can postMessage at us, and a table event becomes a line in the
  room. The matching check on jaffre's side takes the target origin from the
  **referrer**, so a page cannot nominate someone else as the recipient.
- Every framed dad relays the same jaffre event, so the DO drops a `table`
  line identical to one posted in the last 20s.
- **The table stays mounted; the prompts and board do not.** Unmounting the
  iframe restarts the game; keeping the other two alive shows data that was
  true when the page loaded. The e2e caught that regression — keep it.
- **A frame that loads and says nothing is the Safari case.** Safari
  partitions — and can block — storage in a third-party frame, and jaffre's
  identity is localStorage-only, so it can fail there as a blank panel rather
  than an error. Nothing about that is detectable across origins, so
  `TableColumn` waits `SILENCE_MS` for any bridge event and then offers the
  own-tab link and a retry, above the frame rather than instead of it. Covered
  by an e2e with a deliberately mute stub.
- jaffre's half lives in `jaffre/apps/web/src/embed.ts`, on `main` and
  deployed. The two sides share a vocabulary but no code.

## Look and feel (M7)

- **Plain is the brief.** No webfont, no gradient, no shadow, no pill, no
  uppercase label. One system font stack, seven colours, hairline rules, and
  the browser's own defaults wherever they are already right. If a change adds
  decoration, it is going the wrong way.
- Light and dark both ship, following the OS via `prefers-color-scheme`.
  There is **no toggle** on purpose — the OS already holds that preference.
- `npm run audit:contrast` checks every rendered pair **in both themes** and
  exits non-zero on a failure. Run it after touching a colour.
- `border` separates rows that read fine without it and is not gated;
  `border-strong` is what makes a control findable and is held to WCAG 1.4.11.
  Keep that distinction — it is why buttons and inputs use the stronger one.
- The message list is bottom-anchored via `margin-top: auto` on its first
  row, not `justify-content: flex-end` — the latter clips the top of a scroll
  container once the content overflows.
- `src/web/messageGroups.ts` turns messages into rows: consecutive lines from
  the same dad drop the repeated name, and each day opens with a divider. It is
  pure and tested; keep the rendering dumb.
- Nothing in `tokens.css` is per-component colour: every rule reads a token,
  so a palette change is one block, not a search.

## Production (M8)

Live at **dads.marcportal.com**. D1 `dads`
(`85eeefc6-39ed-4189-b2ea-a4c58dc8649c`), `SESSION_SECRET` set as a Worker
secret, custom domain bound by the route in wrangler.toml.

- **The Workers runtime caps PBKDF2 at 100,000 iterations** and throws
  `NotSupportedError` above it. **Local workerd does not enforce that**, so
  120,000 passed all 140 tests and then 500'd on the first real join.
  `test/auth.test.ts` now pins the constant. Treat every other crypto
  parameter the same way: local agreement is not production agreement.
- Changing the iteration count invalidates every stored invite hash, because
  the hash is the derivation. Rotating it means re-running
  `group:create --code "<same code>"` for each group.
- Deploy is `npm run deploy` (build then `wrangler deploy`). Migrations are
  separate and go first: `npm run migrate:remote`.
- `npx wrangler tail --format json` is how you find out what actually threw.
  The Worker's `[observability]` block is what makes those logs exist at all.

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
