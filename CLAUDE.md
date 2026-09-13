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
- `scripts/create-group.ts` is the only way a group comes to exist, and
  `--rotate` is how a code changes. Rotating UPDATEs the hash and salt in
  place: the members, the archive and the board are the group's history and
  must not be collateral damage from changing a passphrase.
- **An invite link carries its own secret, never the code.** The code is stored
  only as a PBKDF2 hash, so the app cannot put it in a link — it does not know
  it. `POST /api/invite` mints 256 random bits, HMAC'd at rest like a device
  token, good for a week and for as many dads as it is sent to. Joining with
  `{ invite }` skips the code field entirely and fails into the same message a
  wrong code gets. The token is stripped from the address bar before the join
  screen paints: it is a credential, not a route.

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
- **A line is delivered when it comes BACK, not when `ws.send` did not throw.**
  The socket a phone leaves behind in a dead spot stays readyState OPEN and
  swallows everything; nothing closes and nothing throws. So every chat frame
  carries a `cid` the browser chose, the room echoes it on the broadcast, and
  the sender holds the line in an outbox until it sees its own id. Unanswered
  after 8s, the client closes its own socket so the reconnect can re-send.
- **The room drops a repeat of a cid it has already posted** (5 minutes of
  memory, in the object rather than the tail — a re-send only ever happens
  seconds after the first try). Without it, every recovered line would post
  twice.
- Three things stop the outbox growing for ever: 20 lines held, 3 tries each,
  and an `error` frame drops the oldest — a body the room refuses would
  otherwise be re-sent all evening.
- **A line can be taken back, and then it is gone.** `{ t: 'retract', id }` in,
  `{ t: 'gone', id }` out. Only your own and only what you TYPED — `chat` and
  `prompt`; the room's own lines are facts about the evening and nobody's to
  edit. The archive is the authority on who said what, because the tail holds
  five hundred lines and the photograph a man regrets may be older; the tail is
  consulted too, so a line whose archive write failed is still his to withdraw.
  **The attached media goes with it**, blob and record — a photo that outlived
  its line is the whole reason anyone wants this. No time limit, for the same
  reason. Refusal is silent.
- **`retracted` in the DO is only for a socket that resumes without
  reloading.** It holds a day of ids and rides along on `hello.gone`. A reload
  needs none of it: the line is out of the tail, so a fresh backfill cannot
  mention it.
- **Taking it back is not optimistic.** The line stays on his own screen until
  the room says it is gone. For this one feature, a local vanish that failed on
  the wire would be the worst possible lie.
- **A mark is one tap, and there is no picker.** Five fixed emoji in
  `REACTIONS` (protocol.ts), allowlisted in `parseClientFrame` before the
  string ever reaches a column — this ends up on everyone's screen and there
  is no reason for it to be free text. Rows live in D1 (migration 0014), never
  in the tail, and are hydrated on backfill beside the attachments. The
  primary key is the whole row, so pressing the same one twice takes it off.
  `message_id` cascades, so a line taken back takes its marks with it — the
  retract path relies on that rather than doing it by hand.
- **Marks render only when there are some.** Adding one is in the long-press
  menu, so a line nobody marked carries no control and the room at rest looks
  exactly as it did before this existed. The count is of dads, not a badge;
  who they are is in the title and the accessible name.
- **A mark is optimistic and taking a line back is not**, which is the same
  rule twice: a mark that fails costs nothing and the next frame corrects it,
  where a retraction that vanished locally and survived on the wire would be
  the worst possible lie.
- **The menu is capped by `--radix-popper-available-width`, never a fixed
  width.** It is anchored at the point he pressed, so near the right-hand edge
  of a 430px phone there is about 200px — and a fixed 240px put the fifth mark
  off the screen where nobody could reach it. Capped by the variable Radix
  publishes for exactly this, and the marks wrap rather than shrink. Pinned by
  an e2e that presses the far edge of a line and checks all five.
- **`LineMenu` is a Radix context menu** — right-click on a laptop and a long
  press on a phone from one primitive, keyboard route included. It wraps only
  chat and prompt lines. The destructive item ARMS on the first select
  (`event.preventDefault()` keeps the menu open) and fires on the second,
  because a long press is a gesture a thumb makes by accident.
- **`sending` must come off in a `finally`.** `upload()` does not always
  return: `fetch` REJECTS on a network failure rather than answering, which is
  the wifi-to-LTE hop this whole app is built around. `sending` disables the
  Send button, the microphone and the file picker alike, so without the
  `finally` a dad was left holding a composer he could not use, with nothing
  on the screen saying why, until he reloaded.
- The composer stays live while the socket is down. Taking the keyboard off a
  man because the network went is the app making its problem his.

## Dad night (M3)

- `src/shared/dadNight.ts` is pure and is the only place instants are computed.
  A slot is `(weekday, "HH:MM", IANA zone)`, never a timestamp, so 21:00 stays
  21:00 across DST. Do not "simplify" it to a stored UTC time.
- The DO has exactly one alarm, so the `schedule` table multiplexes it
  alongside the leave-grace `leaving` table. `rescheduleAlarm()` always arms
  the earliest across both. Anything new that wants a timer goes in `schedule`.
- **Three timers, one alarm.** `night_remind` fires 24 hours out and pushes
  "Dad night tomorrow. Coming?" to the phones that asked — and says NOTHING in
  the room, because a weekly line saying it is nearly Thursday is furniture.
  `ensureNightScheduled` arms the reminder and the start together; it must not
  early-return on "something is armed" between them.
- **Who is coming is a separate question from when it is**, and it is the one
  that decides turnout. `rsvps` (migration 0012) is keyed on the OCCURRENCE —
  the instant the evening starts, computed by `occurrenceOf` from the group's
  slot and never taken from the client, so two phones cannot disagree about
  which Thursday they mean. One row per dad per evening; the room hears it by
  name; pressing the button you already pressed says nothing.
- **The night sheet is where the week collects what the night is for.**
  `night_items` (migration 0013) is keyed on the same occurrence as an RSVP, so
  a thought had on Tuesday belongs to Thursday and one had at ten past nine
  belongs to the evening happening around it. Any dad adds; only its author can
  take it back, enforced by the `member_id` in the DELETE. No status, no
  ticking off — a list to look at together, not a backlog to work.
- **Adding one is announced WITH the thing itself**, which is the one room line
  that carries its own detail instead of pointing at a sheet: half the value of
  a man writing it down is another man reading it and thinking of his own. The
  line that OPENS the night carries only the count, like the board — the count
  is what makes anyone look.
- **`GET /api/night.ics` is a TZID and an RRULE, not an instant.** 21:00 stays
  21:00 across a DST shift, for the same reason a night is a slot. No VTIMEZONE
  travels with it — every calendar resolves IANA names, and a hand-rolled one
  that drifts is worse than none.
- The night is set from the menu's dad-night item, NOT from Settings. Settings
  is what a dad sets once; the night is what the group keeps deciding, and it
  belongs beside the answer to it.
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
- **A reconnection does not clobber a countdown.** `noteAfter` is the table's
  one line of status, and a `reconnecting` event used to overwrite whatever
  was there — so a seat counting down to a bot swap lost the count and the
  dads lost the only sign the table was going to unstick itself. Reconnecting
  now only claims the line when nothing else holds it.
- jaffre's half lives in `jaffre/apps/web/src/embed.ts`, on `main` and
  deployed. The two sides share a vocabulary but no code.
- **The quiet seats never become lines** (2026-09-11). The bridge grew
  `turn` (a sitting player's turn has run to the last 20s), `away` (a seated
  dad dropped, with the bot-swap countdown; 0 means the bot has it), `back`,
  and `connection` — still `v: 1`, because an unknown kind was always
  dropped. `tableSaid` returns null for all four: they are said in the
  panel's own head (`table-note`, a countdown that clears itself) and, for
  `turn`, pushed to the ONE dad it concerns, joined on the display name
  jaffre was handed on the way in, at most once every three minutes. A line
  in the room saying a man's turn has sat for twenty seconds, every hand,
  would be furniture.
- **`.table-frame` is a flex column, not grid rows.** With rows, the "isn't
  answering" notice took the stretchy row and the game got the leftover one
  — two thirds blank and the table squashed, on exactly the browsers that
  show the notice.

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
- **No rule dresses a bare element any more.** `button`, `input`, `select` and
  `textarea` had defaults from M7; they reached into controls that never asked,
  and 0.75rem of side padding on `button` put the Radix switch thumb 13px into
  its track and hanging off the right end. Every control carries its own class.
  Do not add an element selector back.
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
- **The palette is "Ink and Salt"** (2026-09-11), and it is the app's own.
  What it replaced was borrowed: `#0b57d0` is Google's blue out of Material
  and `#b3261e` is Material's error red, which is most of why the app looked
  like nothing in particular. Near-monochrome now, with the one colour
  (`#28486b` light, `#9dbedd` dark) spent on what means something — a link, a
  filled button, the focus ring, the mark on the menu — and never on chrome.
  Changing a hex means changing it in FIVE places by hand: `tokens.css`,
  `index.html`'s two theme-color metas and its pre-paint script,
  `src/web/theme.ts`, `public/manifest.webmanifest` and `public/icon.svg`
  (then `npm run icons`). An e2e pins the dark `--bg` as an rgb triple for
  exactly that reason.
- **One webfont, on names and titles only.** Bricolage Grotesque 700, the
  latin subset, ~40 KB, self-hosted in `public/fonts/` — a private room should
  not tell Google who opened it and when. It is carried by the `.display`
  class and reaches three things: the door's wordmark, the group's name in the
  room header, and a sheet's title. **Nothing a dad reads a sentence of ever
  changes face** — the conversation, the composer, the week and the questions
  stay on the system stack, which is both the readable answer and the free
  one. This reverses the earlier "no webfont" rule: a near-monochrome palette
  has to get its identity from somewhere, and this is the cheapest somewhere.
  It is preloaded in `index.html`, `crossorigin` even though it is same-origin,
  because a font is always fetched in CORS mode and without it the browser
  downloads the file twice.
- **Plain is still the brief for words.** No gradient, no
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
- `npm run backup` writes `backups/dads-YYYY-MM-DD.json` — every D1 table, plain
  JSON, gitignored. D1 Time Travel covers thirty days and the mistake you
  notice this month; this covers the one you notice in June. R2 blobs are not
  in it, only their records.
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

## Home

- **The app opens on home** (2026-09-12), not in the conversation. Four of the
  five questions a dad has when he picks up his phone are not "what was said":
  when the night is, whether anyone is about, whether he has answered, and
  whether anything is waiting for him. Those used to be a countdown that only
  appeared inside 24 hours plus three items behind a menu.
- **It is a VIEW, not a route.** `data-view` on `main.room`; the socket, the
  call and the table all live above it. So switching costs nothing, presence
  is live rather than polled, and going in is instant rather than a reconnect.
  Home sits BESIDE the stage and the stage is hidden with CSS — taking it out
  of the tree would unmount the table's iframe and restart a game.
- **The unseen count is DERIVED from the last line he looked at, never
  tallied.** `seen.ts` keeps that mark per device; the count is
  `messages.filter(seq > mark).length`. It used to be an accumulator starting
  at nought each load, so every backfilled line incremented it and opening the
  app on a conversation he had already read announced forty-one new ones. A
  reload, a reconnect and a backfill now all agree because they are all
  reading the same mark. Pinned by an e2e that reads, reloads, and expects
  silence.
- A dad who has never opened the room on this device has NOTHING to catch up
  on: the mark starts at the newest line he was handed. The archive is not a
  backlog.
- **The way back is its own control**, first in the header, the way every app
  on a phone does it. It was the group's name with a chevron, which is the
  convention on a desktop and something nobody finds on a phone.
  Its hit area reaches UP into the header's own padding and never down:
  reaching down put it over the night line below, which — being later in the
  document — quietly swallowed every tap meant for home.
- **`.quiet` means muted, `.error` means danger.** They shared one rule and
  both painted danger, so an empty room announced "nobody has said anything
  yet" in alarm red, and so did a file's size while a dad was picking it. Red
  is for what went wrong.
- **The way in says how many.** A dad who only came to talk spends one tap and
  sees the count on the button he was going to press anyway. Going in clears
  it: a count that survived walking through the door would be a badge rather
  than an answer. Read through a ref so scrolling inside the conversation
  never retriggers it.
- **A new line is unseen unless the conversation is on the screen.** `watching`
  is `view === 'talk' && !tableOpen`. The table used to fall through that
  check and count nothing at all.
- **Home is a LIVE screen, and the night is part of what is live.** Presence
  comes off the socket, but the night was fetched once at mount, so a dad
  sitting on home watched the list of who is coming go stale while the room
  said otherwise a foot below. It re-reads on the newest `rsvp` or
  `item_added` seq — that kind of line, not any line, because a chatty evening
  is not a reason to re-read the night thirty times.
- **The header does not repeat what home says.** The night line is hidden on
  home, where the same thing is the first item on the screen at four times the
  size.
- **Home never asserts a fact it has not been told.** The roster comes off the
  socket and home paints before the socket has said anything, so an empty
  roster at that moment means "I do not know" — and it used to render
  "Nobody else is here right now", which is the app inventing bad news and
  correcting itself a second later. The same for who is coming, which said
  "Nobody has said yet" before the fetch had landed. Both show `…` instead,
  which is the vocabulary the roster sheet already uses. A RECONNECT keeps the
  last roster rather than falling back to `…`: it was true a moment ago, and a
  wifi hop should not blank the screen.
- **The header does not repeat what home says — including the mark.** The
  night line was already hidden on home for this reason; the dot on the Menu
  button was not, and home lists the very things it stands for, in words, an
  inch below it. It comes back the moment he walks into the conversation,
  where nothing else is saying it.
- **Who is coming reads at ink.** It was `text-muted` — the same grey as the
  section label above it — and it is the thing that actually decides turnout.
- e2e: `talk(page)` (`e2e/talk.ts`, and `prod/names.ts`) steps into the
  conversation and is idempotent, because these suites walk through screens
  and it must not matter which one the last step left him on.

## The three switches

- **`PUT /api/rooms` is any dad's to change and nobody's to own**, like the
  night. Two dads seeing different menus is how a group stops sharing a room,
  so it is the group's setting and not each man's, and it is announced to
  nothing — a switch is not news, and the change reaches every open socket
  anyway.
- **A switch is a boolean or it is absent.** Anything else used to reach
  `Number()`, and a NaN bound to D1 is a NULL rather than a nought: the row's
  NOT NULL constraint threw and the dad got a 500 with a stack behind it. A
  non-boolean is a 400 now, and `null` still means leave it alone.

## What is in the room, and where

`Room.tsx` was a thousand lines holding home, the conversation, the composer,
the media, the seen-mark and every sheet. The "an effect behind a hidden
screen still runs" bug below is that shape biting. It is the wiring now, and
these are the parts:

- **`RoomHeader`** — the app bar. Presentational; the structural rules that
  stop it widening the page live with it.
- **`Lines`** — the conversation. Dumb on purpose: `messageGroups` decides
  what a row is, this only draws it.
- **`Composer`** — the field, the picker, the microphone and everything a
  half-finished line is. It owns that state, because nothing above it needs
  to read a draft.
- **`Sheets`** — everything behind the Menu button, which is the app's own
  model of itself. Each still mounts on open, so it reads fresh data.
- **`useSeen`** — what he has read and where the list is: the mark, the count,
  the follow-down, the tab title, the visibility rules. One hook because it is
  one question asked three ways, all answered from the one mark.
- **The divider-landing effect stays in `Room`**, because it is the only one
  that depends on what was RENDERED — whether `toRows` actually placed a
  divider, which it declines to do at the top of a list.

- **`useFreshBuild` takes a FUNCTION, not a boolean.** It is only ever asked
  at the instant a dad comes back to the app, and the answer has to be the
  current one. As a boolean, "his hands are free" had to travel from the
  composer up through a state change and a render, and the frame that took
  was a reload landing on the line he had just sent. The composer writes
  `busy` into a ref during render, the way `useSeen` writes `pinnedNow`.
  `e2e/fresh.spec.ts` is what caught it.

## An effect behind a hidden screen still runs

Home and the conversation are two views of one component, and the stage is
hidden with `display: none` rather than unmounted — so every effect written
for the conversation fires while a dad is standing on home, where it can
neither see nor scroll anything.

- **The divider effect was the one that bit.** It scrolled to "new since you
  were here", and it fired behind home: the scroll went nowhere, the
  once-per-boundary guard was spent, and `pinned` was turned off — so when he
  finally walked in, the view-change effect declined to scroll him and he
  arrived at the OLDEST line of a five-hundred-line backfill, for exactly the
  dad this feature exists for. Anything that measures or moves the list needs
  `view === 'talk'` in it, not just in its dependencies.
- **Keep a socket-driven refetch keyed on the KIND of line that can change
  its answer**, never on the newest line of any kind. `nightPulse` and
  `todoPulse` are that; `/api/todo` was keyed on every line, so five dads
  talking through an evening each spent a round trip per line.

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
  says which, in words ("a question for you", "your week to fill in") rather
  than a dot: a mark says "something", and something is what a man ignores. A mark for something somebody else did would be noise, and a
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

## Finding a line

- **The archive was write-only until this existed.** The room backfills five
  hundred lines and D1 keeps every one, so for five men talking for a year
  almost everything they have said was on the disk with no door to it.
  `GET /api/search?q=` is that door, and it reads D1 rather than what is
  loaded — the whole point is that the line is older than the backfill.
- **Only what somebody TYPED.** `chat` and `prompt`, never `system` or
  `table`: the room's own lines are furniture, and fifty of them would bury
  the one line he wanted. Same rule as retraction, and the same reason.
- **LIKE, not FTS5.** A substring is what a man means when he half remembers a
  word, it needs no second table to keep in step with retraction (which
  DELETEs the row, so a line taken back is unfindable for free), and at the
  size of a group of five it is a scan of nothing. `%` and `_` are escaped
  before they reach the pattern — a bare `%` would otherwise return the whole
  archive — and a test pins that. Case-insensitive for ASCII only, which is
  what SQLite gives; an accent has to be typed as it was written.
- **`src/shared/highlight.ts` splits, it never substitutes**, exactly like
  `linkify`: it returns pieces and the renderer builds the `<mark>`, so no
  string a dad typed ever becomes markup, and the needle is matched literally
  rather than compiled as a pattern.
- **A result goes nowhere, on purpose.** The line, who said it and when is the
  whole answer; jumping the conversation to a line from March would mean
  fetching ten thousand lines to arrive at the top of them. A photograph on a
  result shows where it sits and carries no `onOpen` — the viewer holds the
  conversation's pictures, and this one may be older than all of them.

## Who's here

- **Coming and going is not conversation.** `presence` in D1 (migration 0006)
  holds it, the DO writes it with `notePresence`, and it never touches the tail
  or `messages`. In a group of five on phones that switch networks, lines like
  "Marc came in" were most of what the archive contained.
- It is read behind the header's **"3 here"**, which is a button: the roster
  now, then the comings and goings, newest first (`GET /api/presence`, capped
  at 60). The 15s leave grace still applies, so a wifi→LTE hop records nothing.
- The roster itself is no longer in the menu — one place to look, not two.
- **A dad has a name he can change and a face.** Both were fixed at the door,
  and changing a name meant signing out and rejoining — which here means
  arriving as a stranger with none of your history. `PUT /api/me/name` writes
  D1 then tells the room, which re-stamps his open sockets' attachments (the
  roster is built from those, so without it the other four keep the old name
  until he reconnects) and says one line. A face changing is not news and says
  nothing.
- **A face is NOT a `media` row.** One R2 object per dad at
  `faces/<group>/<member>`, overwritten in place, with the key on
  `members.avatar_key`. A photograph posted to the room counts against a shelf
  of ten and gets pruned, and a man's own face must never be thrown away to
  make room for a picture of somebody's barbecue. It also means a group of
  five owns five objects for ever, however often they change them.
- **`avatar_at` is a version, and it lives in the URL.** It rides the roster
  as `RosterEntry.face`, and the client builds `/api/face?member=…&v=…`. That
  is what lets a face be `immutable` for a year and still change the instant a
  dad sets a new one. `private`, because whatever sits in between is not
  entitled to keep a photograph of somebody.
- **Cropped and shrunk in the browser** (`prepareFace`, 320 square, centre
  crop). Unlike a photograph there is NO fallback to the original: a face the
  browser cannot decode is a face this app cannot show, and a twelve-megapixel
  one is not a face.
- **The conversation shows faces, in a FIXED 2rem gutter.** The message row is
  `2rem 7.5rem 1fr auto` — face, name, what he said, the clock — and both of
  the first two tracks are fixed for different reasons. The gutter, because a
  flexible column is exactly what crushed the name to "M…" and made the phone
  layout two rows in the first place. The name, because **every line is its
  own grid**, so `auto` sized each row to its own contents and no two lines of
  the conversation began at the same place.
- **Every cell is placed by hand.** Auto-placement counts children, not
  columns: on a continued line, with no face in the gutter, the words slid one
  column left and were laid out in the 7.5rem meant for a name. `e2e` pins the
  alignment at both widths, because this is the kind of thing that regresses
  without anybody noticing.
- **A face appears once per run**, at the top, like the name. The room's own
  lines start in column 2 — nobody said them, so nothing belongs in the column
  that says who did.
- **Faces come from `hello.members`, not from the message.** `members` is
  everyone in the group; `roster` is who is CONNECTED — and a line said on
  Tuesday by a man who is not here tonight still wants his face beside it. One
  source of truth, so a face set this evening reaches every line he ever
  wrote, and a `member` frame keeps it current without a reload.
- **A dad with no face gets his initials, never an empty circle.** The whole
  job is telling five men apart and a blank is worse at that than two letters.
  Split on whitespace, so "Marc-antoine" is M and not MA.
- **The roster answers the question; the log is behind one more tap.** "In
  and out" is a disclosure button, collapsed by default. Tests that want a
  row from it click `comings` first.
- **The call is read here too.** Who is on it and who is muted used to be a
  row of names under the call buttons; that row is conversation now, and the
  count there is a button into this sheet. A roster pill carries a phone or
  a mic-off icon with the words sr-only, and `data-on-call` for a test.

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
- **Chrome does not hand back the host Google documents.** A real subscription
  came back as `jmt17.google.com/fcm/send/…`, not `fcm.googleapis.com`, and the
  allowlist refused it — the switch would not have stayed on for most of the
  dads, silently. Google's hosts are matched by SUFFIX and narrowed by path
  (`/fcm/send/`) instead; the real endpoint is in the test. Do not re-tighten
  this to the documented hostname.
- **Proving it needs a real profile.** Headless Chrome reports notifications
  `denied`; a normal Playwright context is incognito and has no Push API at all.
  `chromium.launchPersistentContext` headed, with notifications granted, can
  subscribe for real — and `registration.getNotifications()` from the page is
  how you see that the worker actually showed one.
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
- **"New since you were here" is a divider, not a badge.** `src/web/seen.ts`
  keeps the last `seq` he was looking at, per device and per group, in
  localStorage beside the theme — nothing is sent, because whether a man has
  read a line is his business. A line counts as seen only while he is at the
  bottom with the tab showing. `toRows` takes a `since` and puts at most ONE
  divider before the first line after it, and none at the very top of the
  list: a divider above everything says nothing a fresh list does not. Coming
  back after half an hour hidden re-reads the boundary and lands him on it,
  once per boundary, with the count saying how many are below.
- The tab's own title carries the unseen count. No permission, no prompt, no
  service worker — the one free signal a browser gives.
- **Links are split, never substituted.** `src/shared/linkify.ts` returns parts
  and the renderer builds anchors from them, so no string ever becomes markup;
  http(s) only, so nothing else can become an href. What a link SHOWS is
  `shortLink`: no scheme, no www, forty characters, and the host is never
  cut, because it is the part that says where he is being sent; the full
  address is the anchor's title. Underlined, because the preflight strips
  the browser's underline and axe rightly refused a link told apart by
  colour alone.
- A photo in the list is capped at 16rem tall as well as 20rem wide. Tap
  for the real one.
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

- **A voice note is the point of the composer, not a corner of it.** A dad
  with a child on his hip does not type a paragraph, and the thing he wanted to
  say goes unsaid. With nothing typed the composer offers the microphone; the
  moment he types a letter it offers Send. Never both — four controls on a
  phone row is three.
- `src/web/recorder.ts` owns MediaRecorder. Two minutes and it stops itself,
  under half a second is a thumb and is thrown away, and the track is stopped
  every time rather than held open so the browser's recording indicator goes
  off when he is finished. No two browsers agree on the container — Chrome and
  Firefox give webm/opus, Safari mp4/aac — so the list is tried in order and
  the browser's own default is the fallback. Audio is on the inline allowlist
  for the same reason video is, and a test pins all five types.
- It posts with no caption and no confirmation step: a voice note that has to
  be approved is one more step between the man and the thing he wanted to say.
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

- **A photograph opens IN the app** (`Viewer.tsx`, 2026-09-12). It used to be
  an anchor to the raw file with `target="_blank"`, which from the app on a
  home screen throws a dad out into a browser with no way back but the app
  switcher — for the one thing in here nobody would expect to be hard to look
  at. Radix Dialog, so the focus trap, Escape and the inert background come
  from the same place the sheets get them.
- **The viewer holds every photo in the CONVERSATION**, built from
  `room.messages` rather than fetched: these are the ones he is looking at,
  and moving between them should not depend on the network. Arrows and
  buttons both.
- **Saving tries the share sheet first**, falling back to a download anchor.
  On a phone the share sheet is "Save Image", and it is the only route iOS
  really gives a web page to the camera roll; a downloads folder is not
  somewhere a phone really has. The fetch resolves from cache — the picture is
  on the screen — so the user gesture is still live when `share()` is called.
  A cancelled share is an `AbortError` and is not a failure.
- **The viewer's ground is solid black and its own palette**, the one place in
  the app that is not on the tokens: a photograph of people is looked at
  against nothing. At 90% the conversation read straight through it. The image
  is `contain`, never `cover` — a picture of somebody's child does not get its
  edges cropped to fill a screen.
- Video and voice notes are NOT in the viewer. A clip has the browser's own
  player with its own full screen and its own save, and a voice note is not
  something to look at. Anything off the inline allowlist already downloads.
- **A man may only hang up what he took.** `mediaFor` scopes an id to the
  GROUP, which is right for serving it and wrong for attaching it: every id in
  the room is already on every client, in its own messages, so one dad could
  put another man's photograph on a line of his own. And because taking a line
  back takes its picture with it, retracting that line deleted the blob and
  the record — the photo then disappeared off the line the man who took it had
  posted, with nothing anywhere to put it back. The sender is compared as well
  as the group, on the way in.

- **Content types are an allowlist, and `image/svg+xml` is not on it.** An
  SVG is a document that can carry script; serving one inline from our own
  origin runs an uploader's code with this app's session. Anything not on the
  list is stored and served as `application/octet-stream`, with
  `X-Content-Type-Options: nosniff` and `Content-Disposition: attachment`.
  Do not "fix" a file that downloads instead of rendering by widening this.

- **Two shelves, and they cannot push each other off.** Ten pictures to a
  room, thirty voice notes; past either, the oldest of THAT kind goes, blob and
  record together. One shelf is what it was until voice notes arrived and a
  chatty week started deleting photographs — the one thing in here nobody would
  ever expect to be thrown away, and two orders of magnitude bigger per object.
  The partition is the stored content type, so anything not on the allowlist is
  `application/octet-stream` and shares the tighter cap with the pictures.
  The cap is still the feature.
- **A photograph can be made to stay** (migration 0016). The cap is still the
  feature, but the thing that falls off the shelf is a photograph of somebody's
  child, and a default is not an absolute. `media.kept` exempts a row from the
  pruner AND from the shelf's count, so keeping one never costs the room the
  next one; `KEPT_PER_GROUP` (20, across both shelves) is what stops a group
  keeping its way to an unbounded bucket, and being full is a 409 a dad is
  told about rather than a switch that quietly does nothing.
- **Any dad may keep anybody's picture**, like the night and the three
  switches — and unlike taking a line back, which is about what a man SAID and
  is his alone. What the room keeps belongs to the five of them.
- **Keeping is not optimistic.** Same rule as retraction, and the same reason:
  a mark that fails costs nothing, but a dad who believes a photo of his child
  is safe when the keep never left the phone has been lied to. The pin appears
  when the room says `kept` — a frame broadcast to every open socket, so two
  dads looking at one picture never disagree about whether it survives — and a
  refusal lands in the composer's status line.
- **Letting one go is not a delete.** It goes back on its shelf as the oldest
  thing there, and the next upload may be the end of it. That is the shelf
  working, not something a dad asked for.
- **"Stays" is not "Save".** The viewer's save puts a copy on the phone and in
  French it is already _Garde-la_; the shelf needed its own words or the two
  read as one thing.
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

## From the home screen

- **A home-screen app is not loaded fresh; it is woken.** Nothing is cached
  (the service worker keeps no shell, every asset revalidates), so a cold load
  is always the newest build — but iOS keeps the page alive for days, and a
  dad goes on running last week's build while the room runs this one.
  `useFreshBuild` asks the door for its bundle name (`bundleOf`, pure and
  tested) on every return to the foreground, at most once a minute, and
  reloads when it differs. It holds back while he is busy — a draft, a photo
  chosen, a recording, a call — and remembers the answer so the next return
  reloads without asking again. A cold load is never checked: `pageshow`
  counts only with `persisted`. Covered by `e2e/fresh.spec.ts`.
- **The keyboard covers the page on iOS; it does not shrink it.** `100dvh` is
  still the whole screen with the keys up, so `main.room` is
  `var(--app-h, 100dvh)` and `useVisualViewport` keeps that at the visual
  viewport's height. Android is told `interactive-widget=resizes-content` in
  the viewport meta instead. Do not go back to a bare `100dvh`.
- **Text fields are 16px, never 15.** Under 16px iOS zooms the page in on
  focus and does not zoom it back. `FIELD` and the composer both say
  `text-base` for that reason; it is not a taste.
- **Send keeps the keyboard.** `onMouseDown` preventDefault on the Send button
  and a refocus after posting — otherwise every line on a phone ends with the
  keyboard folding away. `room.spec.ts` asserts the field is still focused.
- **Nothing bounces and nothing zooms on a double tap.** `overscroll-behavior:
none` on html and body, `contain` on the list and the sheets, and
  `touch-action: manipulation`. Pinch zoom is left alone on purpose. The app
  has one history entry, so there is nothing for an edge-swipe to go back to;
  jaffre's hash navigation inside the frame is the one exception and is its own.
- **A thumb is 44px.** The composer's three controls and its field are `h-11`,
  the header's two icons are `h-10 w-10` on a phone, the in-call row is `md`,
  and the head-count's hit area reaches beyond its line. `prod/screens.spec.ts`
  refuses anything under 28px; the number here is the goal, that is the floor.
- **`e2e/a11y.spec.ts` runs axe over every scene, both themes**, and fails on
  serious or critical. It found the scroll sentinel `div` inside the `ol` on
  its first run; it is an empty hidden `li` now.

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
- **Every green push to main deploys** (decided 2026-09-11, reversing the
  earlier "no deploy job" rule). The `deploy` job in ci.yml runs after the
  `ci` job, in the order the hand-run always had: `migrate:remote`, then
  `deploy`, then a check that the live door names the bundle this build made.
  It does not wait for the browser suite, which runs on the same commit right
  after. Switched by the `DEPLOY_ENABLED` repository variable; needs
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository secrets.
  `npm run deploy` by hand still works and is how to ship when CI is down.
- A migration now goes live the moment it is merged. The unit suite applying
  it to a fresh D1 is the safety check; a migration that needs a hand on it
  (a backfill, a rename) is a reason to set `DEPLOY_ENABLED` to `false`
  first, run it by hand, and switch back.

## The room on a phone

- **The header is an app bar and must be structurally incapable of
  overflowing.** The name gives way (`min-width: 0` on the left, `flex-shrink:
0` on the actions); `main.room` is `width: 100%` with `overflow-x: clip`.
  Without that an over-long header does not wrap — it makes the whole PAGE
  wider, and the composer ends up half off the right-hand side.
- **A breakpoint cannot be trusted with this.** "Join the call" fits a 390px
  phone and "Embarque dans l'appel" does not; the phone that found it was 430,
  and the guard was written at 26rem. The header's controls are icons below
  48rem in every language, and the structural rules above are what actually
  hold.
- **Safe areas on all four sides.** `viewport-fit=cover` puts the page under
  the notch and the home indicator; the padding pays it back. The top one is
  not optional — without it the group's name sits under the clock.
- **A message on a phone is two rows, not three columns.** Who and when above,
  what he said across the full width. Three columns means a photograph wins and
  the name and the clock are crushed: "Marc-antoine" became "M…". A run from
  the same dad drops the repeated clock as well as the repeated name.

## Proving it in production

`npm run prove` runs `prod/` against **dads.marcportal.com**. It is not in CI
and is not part of `npm run e2e`, because it writes into the room five real
people use.

- It proves the DEPLOYMENT, not the code: the custom domain, the assets binding
  answering before the Worker, the headers that only exist because
  `public/_headers` shipped, the secrets that are only set in production, and a
  D1, an R2 and a Durable Object that are not fakes.
- **It reads the group's state rather than assuming it.** The three room
  switches are the group's to set; a suite that demanded Questions be on would
  fail on a Friday because somebody turned them off. Assert against
  `/api/me`, and `test.skip` what is switched off.
- **Deleting from D1 is only half of a cleanup.** The room serves its backfill
  from the Durable Object's own capped tail, so a line removed from the archive
  goes on appearing for everybody until five hundred more have been said —
  which for five friends is never. The first version of this teardown reported
  itself clean while sixteen test lines sat in the dads' room.
- `POST /api/ops/forget` is the half that reaches the object: archive and tail
  together, matched on a LIKE pattern because the lines it has to reach are the
  ROOM's own and carry no author. Gated on `OPS_SECRET`, which is absent by
  default — without it the route answers 404, and it answers 404 for a wrong
  secret too, so it cannot be found by the shape of its refusal. The pattern is
  bounded at four characters so `%` cannot empty a room by accident.
- **Every dad it invents is named `prove-<what>-<run>`, and everything it SAYS
  carries the same marker** — `note()`, not a hand-written string. The first
  version used `prove-` for names and `prove:` for lines, and four lines
  survived a run that reported itself clean. The run suffix matters: the room's own lines ("X is
  in.") carry NO member id, so they cannot be swept by member — they are
  deleted by a body match on the marker, and without a per-run suffix one run
  reads the last one's announcements.
- It never moves the night. Five people turn up on it.

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
- **Pure logic lives outside the component that renders it**, so the worker
  pool can import it without a DOM. `src/shared/tableNote.ts`,
  `src/web/messageGroups.ts`, `src/web/initials.ts`, `src/web/fresh.ts` and
  `src/web/seen.ts` are all there for that reason, and each one is listed in
  `tsconfig.worker.json`. A helper reached for a browser global (`seen.ts` and
  `localStorage`) is the one that will not go — take the global as a
  locally-typed accessor instead, which is also the honest shape, because
  every call already has to survive storage refusing.
- Anything that shells out goes through `scripts/run.ts`, which quotes
  arguments on Windows. `execFileSync` with `shell: true` does not.
