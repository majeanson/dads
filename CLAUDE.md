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
  row, which renders in the list as well as in the editor. Nobody is left out —
  a board that only shows the dads who turned up is a board that flatters — but
  the men with nothing down yet share ONE line ("Nothing yet: Sam, Dave")
  rather than each getting a row of the same three words.
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

## Two languages

- **FR and EN, chosen per dad and remembered per device.** Not per group: two
  dads read the same conversation in different words. What a dad TYPED is never
  translated — only the app's own voice.
- `src/shared/dictionary.ts` holds every string in both, keyed. It is pure and
  React-free so the worker-pool test can import it; `src/web/i18n.tsx` is the
  context around it. `test/i18n.test.ts` holds the two sides level — same keys,
  same placeholders, nothing left in English on the French side.
- **The room's own lines are facts, not sentences.** `src/shared/said.ts` has
  the `Said` union; `messages.meta` (migration 0007) carries it and `body`
  keeps the English. A row with no meta — everything written before 0007 —
  renders its English body, which is the right answer for it.
- **The curated hundred carry both texts** (`prompts.body_fr`, migration 0008).
  One pool, one deterministic pick, two texts: a dad reading in French answers
  the same question as everyone else. A prompt a dad writes himself has only
  what he typed, and `promptText()` falls back to it.
- Anything with a count needs both plural forms (`plural(lang, n)`): French
  keeps the singular for zero, English does not.

## Light and dark

- The OS is still the default. `[data-theme]` on the root element is an
  explicit override — a laptop that never flips to dark left a dad no way to
  ask, and "change your OS setting" is not an answer to give a friend.
- The two override blocks repeat the palettes because CSS cannot alias one to
  another. **`npm run audit:contrast` fails if they drift** from the base and
  the media-query block, so the duplication is policed rather than trusted.
- Theme and language are stamped on `<html>` by a script in `index.html`,
  before the first paint. React only keeps them in step afterwards.

## Look and feel

- **Tailwind + Radix + lucide, on our own palette** (2026-09-10). This
  reverses M7's "no library, browser defaults": controls looked like text,
  there were no icons, and the whole thing read as a document rather than as a
  screen.
- `src/web/ui/` is the whole of it: `Button` (cva variants — plain, primary,
  quiet, danger; sm/md/icon), `Sheet` (Radix Dialog), `Switch` (Radix), `cn`
  (clsx + tailwind-merge, so a caller's class beats the component's).
- **The palette is still tokens.css.** `@theme inline` hands the same variables
  to Tailwind, so `bg-paper`, `text-ink` and `border-line` follow light, dark
  and the explicit override — and `audit:contrast` still reads the hexes.
- **The hand-written CSS lives in `@layer components`.** Tailwind's utilities
  are layered, and an UNLAYERED rule beats a layered one however specific: a
  bare `button { background: … }` silently defeated every `bg-*` in the app.
  Layering it is what makes converting one component at a time possible.
- An icon-only control still carries its words — `aria-label` plus an sr-only
  span. An icon with no name is a button nobody can ask for, in a screen
  reader or in a test.
- **Every screen is on the kit now** — the door, the room, the composer, the
  call, the menu, the settings, the questions, the week, who's here, the table
  and the attachments. `tokens.css` is down from 1030 lines to ~860, and what
  is left is layout that Tailwind would have expressed worse: the room's grid,
  the message rows, the bottom-anchored list, the table frame.
- **Plain is still the brief for words.** No webfont, no gradient, no
  shadow, no pill, no uppercase label — and no box, eyebrow, badge or count
  where the words alone do the job. One system font stack, seven colours,
  hairline rules, and the browser's own defaults wherever they are already
  right. If a change adds decoration, it is going the wrong way.
- Light and dark both ship, following the OS via `prefers-color-scheme` —
  see **Light and dark** above for the override a dad can ask for.
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

## The call (voice and camera)

- **Perfect negotiation, not one-sided offers.** Both sides open the
  connection and `negotiationneeded` sends the offer; `polite = me > them`
  decides who yields when two cross. This is not only about glare: a camera
  toggle needs a FRESH offer, and a design where only one side may offer
  leaves the other side's camera inert.
- A `failed` connection calls `restartIce()`, it does not tear down. The
  roster has not changed, so nothing would ever rebuild it — the pair would be
  deaf to each other for the rest of the evening.
- `/api/ice` is fetched **once per call**, memoised. It is `no-store` and each
  hit mints TURN credentials; per-candidate fetches put a round trip in the
  ICE path dozens of times.
- Every remote `<video>` is muted. Sound comes from the `<audio>` elements, so
  a camera going on or off never interrupts it and nobody is heard twice.

- A full **mesh**: every dad connects directly to every other. Wrong for a
  hundred people, exactly right for five — no server in the media path,
  nothing to run, nothing to pay for.
- The handshake rides the room's **existing websocket**. No second connection
  to open, authenticate or keep alive, and the room already knows who everyone
  is. The DO relays `rtc` frames verbatim and names the sender itself, so a
  browser cannot claim to be somebody else.
- `useCall` decides who offers with `me < them`, identically on both sides.
  Without that rule two simultaneous offers collide and neither connects.
- Candidates that outrun their description are queued and added once it lands.
- Mute disables the track; it never removes it. Removing would renegotiate and
  make everyone's tiles flicker.
- Being in the room and being on the call are different things: `inCall` lives
  on the socket attachment, so a dropped connection is off the call by
  definition.
- `/api/ice` mirrors jaffre's: STUN unconditional, TURN a bonus, **never
  errors**. `TURN_KEY_ID` / `TURN_KEY_API_TOKEN` are set in production from
  the Realtime key `dads-key` — its own key, not jaffre's, so rolling one app's
  token never reaches the other. Without them it degrades to STUN-only, which
  covers most home connections but not a strict NAT.
- e2e uses Chrome's fake devices (`--use-fake-device-for-media-stream`) and
  checks the mesh really reaches a peer connection. Whether a human can hear a
  human is not something a headless browser can answer.

## Shape of the room

- **The room is the conversation and the call. That is the whole screen.**
  Header, call row, messages, composer — nothing else, at any width. There is
  no tab strip: tabs are a claim that four things matter equally, and here they
  do not. Anything added above the message list has to earn its row by being
  worth the row of conversation it costs.
- **Everything else is behind the one Menu button**: who's here, Prompts,
  Board, the table, dad night, sign out. Each opens as a `Sheet` — a native
  `<dialog>`, so the focus trap, Escape, the inert background and the backdrop
  come from the platform. Sheets mount on open, so each reads fresh data.
- The Menu carries a mark when something is waiting for **you** — a question
  you have not answered, a week you have not filled in — and the menu itself
  says which. A mark for something somebody else did would be noise, and a
  number invites you to drive it to zero. `/api/todo` is what the marks read,
  and it is deliberately about the caller and nobody else.
- **Dad night appears on the header only inside 24 hours** (`nightSoon`), and
  in full in the menu (`nightItem`). The rest of the week the countdown is
  furniture: the room already posts the open and the summary as lines.
- **The table stays mounted whether or not it is on screen** — unmounting the
  iframe restarts a game — and `data-table="open"` on `main.room` is what shows
  it. Above 64rem, open means half each and the room widens to 74rem; closed,
  the conversation keeps a 44rem measure, because a chat line 1200px wide puts
  the name at one end and the time at the other. Below 64rem it takes the
  room's place. There is no width toggle: one size, and the way to make the
  game bigger is its own tab.
- e2e helpers: `open(page, 'Prompts')` clicks Menu then the item, scoped to the
  `Rooms` navigation and matching on an **anchored regex**, not an exact name —
  an item with something waiting is named "Board — something waiting", which is
  what a screen reader should hear. `close(page)` clicks the sheet's Close.

## Who's here

- **Coming and going is not conversation.** `presence` in D1 (migration 0006)
  holds it, the DO writes it with `notePresence`, and it never touches the tail
  or `messages`. In a group of five on phones that switch networks, lines like
  "Marc came in" were most of what the archive contained.
- It is read behind the header's **"3 here"**, which is a button: the roster
  now, then the comings and goings, newest first (`GET /api/presence`, capped
  at 60). The 15s leave grace still applies, so a wifi→LTE hop records nothing.
- The roster itself is no longer in the menu — one place to look, not two.

## Dad-night reminders (push)

- **Optional exactly like TURN.** No VAPID secrets, no feature: `/api/push`
  answers 503 and the menu never offers the toggle. `npm run vapid` prints a
  pair; they are Worker secrets in production.
- `src/worker/push.ts` is ported from jaffre — VAPID ES256 JWT and RFC 8291
  aes128gcm on WebCrypto, because the node `web-push` package cannot run on
  Workers. The two apps share no code by design; this crypto is the one thing
  worth not writing twice.
- **Per device and per dad, never per group, never on by default.** One
  `push_subscriptions` row per browser that said yes (migration 0009), keyed
  on the endpoint because that is the push service's own identity for it. Dead
  subscriptions are pruned when the send says 404 or 410 — nothing else ever
  tells us a browser is gone.
- **An endpoint is a URL this Worker will later POST to**, so it must be an
  https address or it is somebody choosing where our server sends its requests.
  Pinned by a test.
- `public/sw.js` does ONE job: show the notification and focus a tab. It caches
  nothing and intercepts no fetch — a room full of other people is not useful
  offline, and a stale shell from a cache is the classic way to ship a bug
  nobody can clear.
- **On an iPhone this only works from the home screen.** Apple's rule, not
  ours; `pushShape()` detects it and the menu says so rather than showing a
  switch that cannot do anything.
- Sent from the `night_start` alarm, once, when the table opens. The standing
  night is still the mechanism; this is a nudge for the man who asked for one.

## Small things that turned out to matter

- **New lines follow a dad down only if he was at the bottom.** Scrolling to
  the newest message unconditionally snatches the page out of the hands of
  anyone reading back through the week. `counted` is a ref, not state: only a
  change in the message COUNT does anything, or a dad scrolling would count as
  an arrival and cause the scroll he was trying to escape.
- The tab's own title carries the unseen count. No permission, no prompt, no
  service worker — the one free signal a browser gives.
- **Links are split, never substituted.** `src/shared/linkify.ts` returns parts
  and the renderer builds anchors from them, so no string ever becomes markup;
  http(s) only, so nothing else can become an href.
- **The screen stays awake on a call** (`useWakeLock`). The browser drops the
  lock whenever the tab hides, so it is taken again on the way back.
- **Speaking is worked out locally** (`src/web/speaking.ts`): one AudioContext,
  one analyser per stream, one timer for all of them. Nothing is sent, nothing
  is recorded. It is merged into `peers` at the last moment so a mark going on
  and off never rebuilds a stream object and flickers the tiles.
- **Mute travels over the wire** because a muted man and a quiet one are
  identical from the far end of a peer connection. It rides the `call` frame
  and lives on the socket attachment beside `inCall`, true only while the
  socket is.

## Media

- **Video is on the inline allowlist** (`video/mp4`, `video/webm`,
  `video/quicktime` — what an iPhone calls a .mov). A clip that downloads
  instead of playing is a clip nobody watches, and a container carries no
  script and no origin. **HEIC is deliberately not**: Safari renders it and
  nothing else does, so inlining it would show the picture to the dads on
  iPhones and a broken box to everyone else.
- The cap is **25 MB**, raised from 10 for video: ten seconds off a modern
  phone is fifteen, and the browser cannot shrink what it cannot decode. Ten
  objects to a room still bounds the total.
- `getUserMedia` asks for echo cancellation, noise suppression and gain control
  by name. Every browser does them by default; a default is not a promise, and
  five men in five kitchens is the case they exist for.

- **Content types are an allowlist, and `image/svg+xml` is not on it.** An
  SVG is a document that can carry script; serving one inline from our own
  origin runs an uploader's code with this app's session. Anything not on the
  list is stored and served as `application/octet-stream`, with
  `X-Content-Type-Options: nosniff` and `Content-Disposition: attachment`.
  Do not "fix" a file that downloads instead of rendering by widening this.

- Ten to a room; the eleventh silently pushes the oldest out, blob and record
  together. The cap is the feature.
- Images are shrunk in the **browser** (long side 1600, JPEG 0.82) before
  upload. Every failure path falls back to the original file: a large upload
  beats a failed one.
- R2 objects are **never public**. They are served through the Worker behind
  the session check and scoped to the caller's group; an id from another room
  404s. These are photographs of people's children.
- A failed record write deletes its own blob. A blob with no record is
  unreachable and pays rent forever.
- Attachments are hydrated from D1 on backfill, never stored in the DO tail —
  a pruned photo then quietly disappears from its line instead of rendering
  broken forever.

## Public facing

- **The icons come from one SVG.** `public/icon.svg` is the artwork; `npm run
icons` rasterises the favicon, the 192/512 and the apple-touch-icon from it
  with the Playwright chromium already in the repo. Committed, not built on
  deploy — a deploy should not need a browser.
- `public/manifest.webmanifest` makes "add to home screen" a real app rather
  than a blank square in a browser window, and `robots.txt` plus a `noindex`
  meta keep a private room out of the index.
- **Security headers live in `public/_headers`, not in the Worker.**
  `run_worker_first` covers only `/api` and `/ws`, so for every other path the
  assets binding answers before the Worker runs at all: a wrapper around
  `env.ASSETS.fetch` never fires. Pinned by an e2e.
- `theme-color` is the real `--bg`, light and dark, and `theme.ts` keeps a
  fixed one in step with an explicit choice so a dad who asked for dark does
  not get a white bar above the room.
- **The door carries the language toggle** and nothing else: a francophone
  whose browser says English could not say otherwise until he was inside.

## The talk column is flex, not grid rows

The call bar renders only while there IS a call, and with named grid rows the
conversation inherited whichever row was left over — it jumped to the top of
the screen with the empty space underneath it the moment the bar stopped
rendering. Nothing in that column may depend on how many children happen to
exist: `.col-talk` is a flex column and `.lines` takes `flex: 1`.

## CI

- `.github/workflows/ci.yml` runs format, lint, typecheck, the contrast audit,
  the unit suite and the build on every push. No browser, no wrangler dev, no
  credentials: it stays cheap enough to run on everything.
- `e2e.yml` runs the browser suite after CI goes green on main, nightly, and on
  demand. Split out because it downloads Chromium and boots a Worker.
- **There is deliberately no deploy job.** Deploying means applying migrations
  first and then `npm run deploy`, in that order, by someone who has decided
  the migration is safe. Five friends and one database is not a service with a
  rollback plan.

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
