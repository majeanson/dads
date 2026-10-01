# dads — working notes

Read [PLAN.md](PLAN.md) first. It holds the locked decisions and the milestone
list; do not relitigate a decision recorded there without asking.

This file is the rules. **Why each one exists — what broke, what was tried,
when it changed — is in [docs/decisions.md](docs/decisions.md), under the same
heading.** Look there before changing a rule that seems arbitrary; most of
them were learned the hard way. New reasoning goes there, the rule goes here.

## Rules

- **This repo only.** `~/Documents/WebApp` is a separate parent repo. Never
  commit or push anything outside `dads/`.
- **DO for live, D1 for durable.** Presence, chat fan-out, typing and relayed
  table events live in `RoomDO`. Anything that must survive an eviction —
  check-ins, commitments, prompts, message archive — goes to D1. Long-lived
  records in DO storage are on the wrong side.
- **Multi-group from day one.** Every query is keyed by `group_id`.
- **Tests run against the real schema.** `vitest.config.ts` applies
  `migrations/` to the faked D1; a migration that does not apply fails.
- **Playwright matches accessible names by substring.** Scope to a landmark
  and pass `exact: true` for short names. Same for `getByLabel`.
- **A control needs a real bounding box.** A visually-hidden radio at
  `width:0;height:0` has no hit area; fill the label with
  `position:absolute;inset:0;opacity:0` instead.
- **A fresh browser context is a fresh dad** (cookie + localStorage). Give
  each e2e test its own names.
- **Behavioural e2e only.** Assert what a dad can do, not what a pixel looks
  like.
- **Never leave a dev server orphaned.** On Windows, killing the shell does
  not kill child node processes. Let `npm run e2e` finish or stop it
  explicitly. `reuseExistingServer` is off on purpose — do not turn it on, and
  do not add a script that kills whatever holds the port.
- **No life-as-code here.** Plain repo by decision.

## Secrets and environment

- `SESSION_SECRET` signs the identity cookie and hashes device tokens:
  `wrangler secret put` in production, `.dev.vars` locally. `sessionSecret()`
  throws rather than fall back in production.
- "Production" is `ENVIRONMENT = "production"` in `wrangler.toml`, never the
  hostname. `npm run dev` and the e2e webServer pass
  `--var ENVIRONMENT:development`. A local "SESSION_SECRET is not set" means
  that override is missing — do not fix it by weakening `sessionSecret()`.

## Identity model

- One invite code per group, PBKDF2-hashed with a per-group salt, normalized
  (case, whitespace) before hashing. Never compare codes raw.
- The signed cookie names `{groupId, memberId}`; `currentSession` checks the
  member row on every request. A device token in localStorage, HMAC'd in
  `members.device_token_hash`, rejoins a browser whose cookie is gone.
- Failed joins are throttled per IP in `join_attempts` (10 per 10 minutes);
  only the IP's HMAC is stored. **Nothing clears the bucket** — a success
  once did, and a room of one's own made that a reset button. **Every word
  tried at opening a room or changing a word counts too** ("taken" is an
  answer), checked before the lookup.
- **A write or the socket from another origin is 403** (`crossOrigin` in
  `index.ts`): SameSite=Lax trusts every `*.marcportal.com`. No Origin is
  allowed (scripts, tests); localhost outside production. The Worker deletes
  every `X-Dads-*` the client sent before setting its own.
- `scripts/create-group.ts --rotate` UPDATEs hash and salt in place: members,
  archive and board must survive a passphrase change.
- **An invite link carries its own secret, never the code** (the app does not
  know the code). `POST /api/invite` mints 256 random bits, HMAC'd at rest,
  good for a week and many dads. Joining with `{ invite }` fails into the same
  message a wrong code gets. The token is stripped from the address bar before
  the join screen paints.
- **`/i/*` unfurls** (`routes/preview.ts`, `run_worker_first`): the room's
  name, its next night, `og.png` — never a member's name or a line. Replace
  the shell's own preview tags (crawlers read the FIRST `og:title`). An
  expired or invented token gets the plain preview. The name goes through
  `escape()`. `no-store`, `no-referrer`, and it sets the `_headers` headers
  itself. **An invite speaks the language it was sent in** (`invites.lang`);
  NULL (pre-0023) keeps the bilingual line; a saved choice on the device wins.

## The room (M2)

**Sockets and delivery**

- `/ws` takes the group from the **cookie**, never the URL. The Worker strips
  the cookie and forwards identity in `X-Dads-*` headers the DO trusts. The DO
  is keyed on `group.id`.
- The DO keeps a capped `tail` (500) for backfill and writes every line to D1
  `messages`. **Fan-out happens before the archive write.**
- Clients reconnect with `?after=<seq>&rev=<change>`; `seq` is the dedupe key.
- **A line changing is not a new line**: edits, marks, take-backs, kept or
  pruned pictures are rows in `changes` with a `rev`, and a resume gets what
  each line IS now (`hello.gone/.changed/.media`). 30 days / 5000 rows kept;
  an unknown `rev` gets `fresh: true` and a whole backfill to REPLACE with.
- Leaving is on a 15s grace timer (`leaving` table, one alarm); returning
  inside it cancels the row AND reschedules the alarm.
- Ping/pong is `setWebSocketAutoResponse`, which never wakes a hibernating
  object. Do not replace it with a handled message.
- **A line is delivered when it comes BACK**, not when `ws.send` did not
  throw: every chat frame carries a `cid`, the sender's outbox holds it until
  the echo, and closes its own socket after 8s unanswered.
- **A repeated cid is answered with the line it already became** (`postedCids`,
  5 minutes, `echo()`); one since taken back gets `error` `gone`.
- **Every `IN (…)` goes through `chunks()`** — D1 takes ~100 bound
  parameters, and an unchunked one in the hello path means a reconnect loop.
- The outbox is bounded: 20 lines, 3 tries each, and an `error` drops only
  the line it NAMES by `cid`. A refusal with no cid leaves the outbox alone.
- The composer stays live while the socket is down.
- **`sending` comes off in a `finally`**: `fetch` rejects on a network hop.

**Taking back, editing, replying**

- `{ t: 'retract', id }` → `{ t: 'gone', id }`. Only your own, only `chat`
  and `prompt`. The archive is the authority, the tail consulted too. The
  attached media goes with it, blob and record. No time limit. Refusal is
  silent. **Not optimistic**: the line stays until the room says it is gone.
- **Editing has retraction's authority and honesty**: own lines, never to
  nothing, not optimistic. The composer keeps his words until the line comes
  BACK changed (waits `ACK_GRACE_MS`); a resume that shows his new words
  settles it. Only `edited_at` is kept.
- **A reply carries a SNAPSHOT** `{id, name, body}` (tail first, then archive),
  cut to `REPLY_QUOTE_LENGTH`, only of typed lines; an unknown id posts the
  line without a quote. A quote goes nowhere on a tap.
- **A quote survives an edit, not a retraction**: `unquote()` clears it in
  tail and archive; clients work it out from the `gone` frame.
- A quote is a card in its dad's colour (`Quote` in `Lines.tsx`), coloured by
  name (`useMemberNamed`); the composer's reply strip is the same card.
- **Reply and Edit are the composer's state, held in `Room`**, never both.
  The state is set on select; **focus moves once the menu has closed**
  (`onAway` from `onCloseAutoFocus`). Do not defer the whole action.

**Marks**

- `MARKS` (protocol.ts) is the allowlist, checked in `parseClientFrame`. The
  row shows six: `REACTIONS` defaults, displaced FROM THE END by what he uses
  (`favourites.ts`, per device). Defaults keep their order.
- Rows live in D1 (0014), hydrated on backfill, never in the tail. The PK is
  the whole row (same mark twice takes it off); `message_id` cascades.
- Marks render only when there are some. A mark is optimistic; a retraction
  is not.
- **The menu is capped by `--radix-popper-available-width`**, never a fixed
  width; marks wrap. Pinned by an e2e at the far edge.
- `MarkRow` in `Marks.tsx` is the one row of six and a "+". Emoji button only
  where there is a mouse; double CLICK marks on a mouse.
- **On a phone one tap on the words opens `tap-marks`** (44px each); not on a
  link, photo, control, or with text selected. It scrolls the LIST into view
  (`inView`), in one step, only when it opens or "+" changes it — never
  `scrollIntoView`.

**The line menu and presses**

- `LineMenu` is a Radix context menu, wrapping only chat and prompt lines.
  The destructive item ARMS on first select (`preventDefault`), fires on the
  second.
- **On a phone a long press is the menu and nothing else**: `.lines` is
  `user-select: none` and `-webkit-touch-callout: none` under
  `pointer: coarse`; the click after a long press is swallowed (`notATap`),
  never "a click soon after". The "a menu is open" flag comes down when an
  open menu UNMOUNTS.
- A voice note is the app's own player (`VoiceNote`); it seeks past the end
  once on load because Chrome's recordings report no duration.
- The page behind an open line menu is `inert`; marks in the menu are
  `menuitemcheckbox` (`MarkRow inMenu`).
- A continued line's clock is hidden by `.line .when` (which owns
  `display: flex`), not fought by a utility.

## Dad night (M3)

- `src/shared/dadNight.ts` is pure and the only place instants are computed.
  A slot is `(weekday, "HH:MM", IANA zone)`, never a timestamp. Do not
  "simplify" it to a stored UTC time.
- **A night repeats or happens once, and `date` is the whole difference**
  (civil date in the group's zone). `weekday` is DERIVED from the date on the
  way in.
- **`stillToCome(night, now)` is the test, not `night === null`.** A passed
  one-off is never cleared; `nextStart` returns null and the card becomes the
  calendar.
- **The calendar is the poll; there is no poll table** (`night_votes`). Open
  exactly when there is no night still to come. A tap cycles can → might →
  can't → nothing said. Locking a day in goes through `writeNight` and deletes
  every vote. Any dad locks it in; no rule does it for him.
- **Nothing about the night or the poll is said in the room**; open screens
  hear a `poll` frame (a nudge to re-read).
- **An arranged evening is edited AS a date** (date field; server derives the
  weekday). **"Can't do that night"** calls it off, armed, and the sheet
  becomes the calendar. Calling one off is not clearing a standing night.
- A one-off `.ics` gets no RRULE and its own UID. `GET /api/night.ics` is a
  TZID and an RRULE, no VTIMEZONE.
- **RSVP has three answers** (`in`/`maybe`/`out`). `coming` still rides on the
  wire and `PUT /api/rsvp` still takes `{ coming }` — `public/sw.js` answers
  from the lock screen and a home-screen app can go days between reloads.
- Home's three answers are ONE segmented control (`home-answers`), all on
  screen from the start; "Can't" is ink, not red. The night sheet uses the same
  (`Answers.tsx`). "Full table" shares the countdown's line only when there is
  one.
- **Two consecutive RSVP lines from one dad are one change of mind**
  (`supersedes` in `messageGroups.ts`).
- `rsvps` and `night_items` are keyed on the OCCURRENCE (`occurrenceOf`,
  never from the client). Items: any dad adds, only the author removes (the
  `member_id` in the DELETE). No status, no ticking off.
- **One alarm, multiplexed**: `schedule` (`night_start`, `night_end`,
  `night_remind`) beside `leaving`; `rescheduleAlarm()` arms the earliest.
  Anything new that wants a timer goes in `schedule`. `ensureNightScheduled`
  arms reminder and start together — no early return between them.
- `night_remind` (24h out) and `night_start` push to phones that asked and say
  nothing in the room. `night_end` does nothing but must stay armed: it holds
  the schedule inside the window. Setting a night mid-evening arms its end.
- Any dad sets the night (no admin). `PUT /api/night` writes D1 then tells the
  DO. It is set from home's card, not Settings.
- The standing-night form is collapsed behind `night-standing`; with no night
  it REPLACES the calendar when opened (state lives in `Night`).
- **Every label in the night sheet needs `{ exact: true }`** — thirty
  calendar labels say "…day". The poll's time field has no `aria-label`.
- The night sheet opens on a leaf (`NightLeaf`); who is coming is one line per
  answer, faces first (`rsvp-who` keeps the words specs read).

## Prompts (M4)

- The curated 100 are in `migrations/0003_prompt_library.sql`. **Adding to
  the library means a new migration, never editing that one.**
- The pick is `hash(groupId + day) % poolSize`, written to `prompt_days` and
  never recomputed. The day turns at the **group's** midnight.
- An answer is a `messages` row of kind `prompt` with `prompt_id`; the DO
  resolves today's prompt itself.
- **Every new DO tail column needs a `PRAGMA table_info` check** in
  `initStorage` — `CREATE TABLE IF NOT EXISTS` does not add columns.

## What the two sheets got wrong

- Today's answers are under today's question, on a card.
- The field under today's question says it adds to the POOL (it is not the
  answer box).
- The 1–5 says which end is which on screen; it is one segmented control with
  each segment's word in its accessible name.
- Every field has a visible label; a placeholder is not a label.

## The board (M5)

- `src/shared/week.ts` is pure ISO-8601 weeks in the **group's** zone. Do not
  replace it with "day of year / 7".
- One check-in and one commitment per dad per week (unique index, upsert).
  Changing a commitment resets its outcome.
- **Everything on the board is group-visible**, own row included. Dads with
  nothing down share ONE line of faces (stops at five, "+n", names sr-only).
- `pending` scans back through the shown weeks. A dad closes only his own
  commitment.

## The table (M6)

- Jaffre is framed cross-origin (no XFO, no CSP, no cookies; identity is an
  HMAC token in localStorage).
- Embed URL is `/?name=…&from=dads#room/<code>`, **never** `/join/<code>`.
- `groups.jaffre_room_code` is minted once, then read back, **never the
  bare slug** (the name is on every invite preview). **A new table is
  a new code** (`POST /api/table/new`, `freshTableCode`, armed, any dad), and
  every screen re-fetches on a `stir` with `what: 'table'`.
- Names are cut to jaffre's twenty (`tableName`); nudges and crowns compare on
  the cut name.
- **`event.origin !== JAFFRE_ORIGIN` is the whole security boundary.**
- Only `turn` does anything in the room (a push to that dad, once per 3
  minutes); the rest are the panel's `table-note`. Quiet seats never become
  lines.
- **The table stays mounted once opened, and is not mounted until first
  opened** (`tableEver`). Unmounting restarts the game. Prompts and board do
  NOT stay mounted.
- A frame silent for `SILENCE_MS` is the Safari case: offer the own-tab link
  and a retry above the frame.
- `reconnecting` claims the status line only when nothing else holds it.
- jaffre's half is `jaffre/apps/web/src/embed.ts`; the two share no code.
- **Whoever won the last game wears gold** (`groups.champions`, `winners` on
  `game-over`, human names only). Same crown within a minute is dropped,
  claimed in memory BEFORE the first await (`crownClaim`). `--gold` is audited
  at 3:1.
- `.table-frame` is a flex column, not grid rows.

## Two languages

- FR and EN, per dad, per device. What a dad TYPED is never translated.
- `src/shared/dictionary.ts` holds every string; pure so tests import it.
  `test/i18n.test.ts` keeps the sides level. The French is casual Québécois
  ("Ça a pas marché", "t'es ici").
- The room's own lines are facts: `said.ts` / `messages.meta`; `body` keeps
  the English for rows without meta.
- The curated prompts carry `body_fr`; `promptText()` falls back.
- Counts need `plural(lang, n)` (French keeps the singular for zero).

## Light and dark

- The OS is the default; `[data-theme]` is an explicit override.
- The override blocks repeat the palettes; **`npm run audit:contrast` fails
  if they drift.**
- Theme and language are stamped on `<html>` by `index.html`'s pre-paint
  script.

## Look and feel

- **Tailwind + Radix + lucide on our own palette.** `src/web/ui/` is the kit:
  `Button` (plain, primary, quiet, danger; sm/md/lg/icon), `Sheet`, `Switch`,
  `Tabs` (inside a sheet only), `cn` (a caller's class beats the component's).
- The palette is `tokens.css`, handed to Tailwind via `@theme inline`.
  Nothing in `tokens.css` is per-component colour.
- **No rule dresses a bare element.** Do not add an element selector back.
- **Hand-written CSS lives in `@layer components`.** An unlayered rule beats
  every utility. A layered rule cannot beat an element's utility either — move
  the property into the stylesheet rather than fight it.
- An icon-only control carries `aria-label` plus an sr-only span.
- **A control is 44px** (kit default). `sm`/`iconSm` only inside the
  conversation. `lg` (3.25rem, 17px) is the one action on a sheet; `FIELD`
  matches it. Sheet and door text is 17px; the conversation is untouched.
- Menu and switch rows are 64px at 1.125rem; sheet headers top out at
  `text-3xl` (a `clamp` on `dvh`).
  Check at 390px in French.
- **Every choice of a few is one segmented control** (`TRACK`, `segment()` in
  `Toggles.tsx`).
- Lucide is kept (Phosphor considered and declined).
- **"Ink and Salt" palette.** Changing a hex means FIVE places: `tokens.css`,
  `index.html` (two theme-color metas and the pre-paint script),
  `src/web/theme.ts`, `public/manifest.webmanifest`, `public/icon.svg` (then
  `npm run icons`). An e2e pins the dark `--bg`.
- **One webfont** (Bricolage Grotesque 700, latin, self-hosted, preloaded
  `crossorigin`) via `.display`, on names, titles, home's day and hour, and the
  door. Nothing a dad reads a sentence of changes face.
- Plain for words: no gradient, shadow, pill, uppercase label, badge.
- **It moves**: the motion section at the bottom of `tokens.css` is the whole
  of it. A press answers inside 100ms, an arrival inside 300. **All motion
  stops for `prefers-reduced-motion`** (the a11y suite runs that way). Only
  lines that ARRIVE ease in, never the backfill.
- **The glasses are the symbol** (`Logo`: `on`, `live`, `glint`; `Glasses`).
  - **The splash** (`Splash.tsx`): ONE screen-sized SVG where only the mark
    scales (a scaled big ground crashed Chrome), driven frame by frame from JS
    (Chrome does not repaint a CSS-animated mask). **What it DOES runs on
    timers, never animation frames.** `PACE` holds both films: opening through
    the left lens, smoked; "go and talk" quicker through the right, clear.
    `onCovered` switches the screen underneath.
  - **`entering` is a COUNT** and the splash is keyed on it, so every press
    is its own film. `home.spec` holds the clock still to test it.
  - Going back has no animation.
  - **Every face wears his glasses** (`Face` draws them; `data-glasses`). His
    pair is `members.glasses` (NULL = shades), allowlisted by `GLASSES`, read
    from D1 whenever a `member` frame is sent. The app's own mark always wears
    shades.
  - **Fit** (`members.glasses_fit`, `GlassesFitter`): `{x, y, s}` clamped by
    `parseFit`, only over a photo, cleared when the photo changes, applied
    with CSS `translate`/`scale` (never `transform`). The fit area refuses
    `dragstart`.
  - Arrival is a face popping in with a ring (`face-arrive`); its timer is not
    tied to the effect's cleanup.
  - Every dad has a colour (`dadColour.ts`, hash of his id), six, audited as
    TEXT in both themes.
  - A full table (four) plays once per evening per phone
    (`dads.full.<occurrence>`) on a counter that never resets.
- The menu is one grouped list (`ROW` in `Menu.tsx`, focus ring inside);
  `ITEM` is for boxed rows elsewhere.
- `border` separates; `border-strong` makes a control findable (WCAG 1.4.11).
- The message list is bottom-anchored with `margin-top: auto` on its first
  row, not `justify-content: flex-end`.
- `src/web/messageGroups.ts` turns messages into rows; keep rendering dumb.

## Production (M8)

- Live at **dads.marcportal.com**. D1 `dads`
  (`85eeefc6-39ed-4189-b2ea-a4c58dc8649c`).
- **The Workers runtime caps PBKDF2 at 100,000 iterations; local workerd does
  not.** `test/auth.test.ts` pins it. Local agreement is not production
  agreement for any crypto parameter. Changing the count invalidates every
  invite hash.
- `npm run deploy` by hand; migrations first with `npm run migrate:remote`.
- `npm run backup` writes every D1 table to `backups/` (not R2 blobs).
- `npx wrangler tail --format json` shows what threw.
- **The app reports its own failures** to D1 `oops` (0025); `npm run oops`
  reads it. The Worker's top-level catch and the DO's `noted()` (records,
  then rethrows) write `worker`/`room`; phones `POST /api/oops` (`report()` in
  `src/web/oops.ts`), open to the door, 30 an hour per dad, 30 days kept.
  **A report never carries what a dad typed.** Report a fault, not a choice
  (a refused microphone, a `gone` echo, being offline are not reports).

## The call (voice and camera)

- **Perfect negotiation**: both sides open, `negotiationneeded` offers,
  `polite = me > them`. A camera toggle needs a fresh offer.
- `failed` calls `restartIce()`, never tears down.
- `/api/ice` is fetched once per call (memoised); STUN always, TURN a bonus
  (`TURN_KEY_ID`/`TURN_KEY_API_TOKEN`, key `dads-key`), never errors.
- Every remote `<video>` is muted; sound comes from `<audio>`.
- Full mesh; signalling rides the room's websocket; the DO names the sender.
- Candidates that outrun their description are queued.
- Mute disables the track, never removes it. Mute travels over the wire.
- `inCall` lives on the socket attachment.
- e2e uses Chrome's fake devices; whether a human hears a human is untested.

## Home

- **The app opens on home, and home asks ONE question**: are you coming.
  Anything proposed for home has to displace the night or the door.
- **With no evening to come, it asks "when's the next one?"** with the two
  best days as leaves (`NextDays.tsx`); the month grid stays in the sheet.
- **Home is the card, the door, and Settings in the corner**
  (`home-settings`). **The invite lives inside Settings** (`settings-invite`).
  Everything else is behind the conversation's Menu. There is no Dad night
  row; the card IS the night (`dad-night`). Beside Settings, "What this is"
  (`home-about`): two lines, the door's own sentence and "say if you're
  coming". Keep it that short.
- e2e helpers (`e2e/talk.ts`, mirrored in `prod/names.ts`): `talk`, `home`,
  `menu`, `settings`, `invite`, `night` — idempotent.
- The card is the one place with `--radius-card`/`--radius-control`, on
  `--bg-soft`. **Shapes are passed as Tailwind classes, not CSS.**
- **The door is a speech bubble**; its radius is `rounded-[2.25rem]!` and
  `rounded-bl-[0.5rem]!`, IMPORTANT on purpose (tailwind-merge does not
  know `rounded-app`). `Logo.tsx` is `icon.svg` minus the square, in
  `currentColor`.
- **Home is a VIEW, not a route** (`data-view` on `main.room`); the stage is
  hidden with CSS, never unmounted.
- **The unseen count is DERIVED from the seen mark** (`seen.ts`), never
  tallied. A device new to the room starts at the newest line; an empty room
  starts at nought once `ready`. A line is unseen unless
  `view === 'talk' && !tableOpen`.
- Going in clears the door's count; read through a ref.
- **Home is live**: it re-reads the night on the newest `rsvp`/`item_added`
  stir, not on any line.
- **Home never asserts a fact it has not been told**: `…` until who is coming
  has loaded.
- The header has two shapes. On home: name, head-count, Settings. In the
  conversation: back, head-count, night line, call, Menu; the name is the h1,
  sr-only there. The header does not repeat what home says.
- The way back is its own control; its hit area reaches up, never down.
- `.quiet` is muted; `.error` is danger.
- The table is offered only from the conversation.

## A room of your own

- **Anybody at the door can open a room**: three per address per day (its own
  `join_attempts` bucket), a four-character floor, a word unique across rooms.
- **The word is a fingerprint** (`invite_code_lookup`, normalized word HMAC'd
  with the Worker secret, UNIQUE); PBKDF2 only verifies. Rooms made by the
  script carry NULL, are found by the bounded scan, and learn it on the first
  join. **Do not put the production secret on a laptop.**
- Two rooms cannot share a word (SELECT for the message, UNIQUE for the race).
- The door offers opening a room under the question, and not at all to a dad
  who followed an invite link. Opening a room lets him in on the same submit.
- **The word is the creator's to change** (`PUT /api/rooms/word`) and **the
  room is his to hand on** (`PUT /api/rooms/owner`, one way, armed with the
  name). The app can never show the current word. Changing it kills the
  outstanding invite links. Owner rides the socket (`owner` frame).
- A genuine arrival broadcasts a `member` frame.
- **A phone can be in several rooms**: `POST /api/rooms/mine` lists them by
  device token; `/switch` mints the cookie or 403s. **Switching reloads.** The
  rooms sheet also holds "start a room" and "join with a word".
- **A dad can leave, and the creator can take one out** (0024).
  - **Gone is a mark, never a delete** (`members.gone_at`). `depart()`
    overwrites the device-token hash with `gone:<id>` (NOT NULL, unique per
    group), drops push subscriptions, RSVPs for nights still to come and poll
    votes, and tells the room, which sends `removed`, clears the socket
    attachments (no grace, no second "out"), closes them and broadcasts
    `departed`.
  - **Every query meaning "the men in this room" filters
    `gone_at IS NULL`**: session, device-token rejoin, rooms list, handover
    target, nudges and crowns, the board's empty rows. `hello.members` KEEPS
    him with `gone: true` for his face; client pickers filter it. **A new
    query over `members` has to decide which of the two it is.**
  - Removing is the creator's, and nobody's in a room with no creator. The
    creator cannot leave while anybody else is in (409 `hand_over_first`).
  - The word still opens the door; the creator's fold says so beside the word
    form. A removed dad lands on the door told why; one who LEAVES does not
    (`leavingRoom()`).
  - **A socket refused before it opened asks `/api/me`**, and a 204 is
    `removed`: a phone asleep at the time never hears the frame.

## The three switches

- **The switches are the CREATOR's.** A room with no creator (`created_by`
  NULL) keeps them everybody's — that is not a gap.
- The night, board, poll and keeping a photograph are NOT the creator's.
- A switch is not news. **A switch is a boolean or absent** (else 400).

## What is in the room, and where

- `Room.tsx` is the wiring. `RoomHeader` (structural overflow rules live with
  it), `Lines` (dumb), `Composer` (owns its draft), `Sheets` (lazy-loaded,
  preloaded after home paints by `preloadSheets`, failures stay inside the
  sheet), `useSeen`. The divider-landing effect stays in `Room`.
- `useFreshBuild` takes a FUNCTION; the composer writes `busy` into a ref
  during render.
- **`RoomDO` is the object's surface only**; the rest is in
  `src/worker/room/` (`lines`, `changes`, `hydrate`, `presence`, `call`,
  `night`, `table`, `members`, `internal`, `schedule`, `storage`), each taking
  the one `Room`. **Awake-only state is `room.memory`, never module scope** —
  objects share an isolate. The frame switch ends in a `never`.

## An effect behind a hidden screen still runs

- The stage is hidden, not unmounted, so conversation effects fire on home.
  **Anything that measures or moves the list needs `view === 'talk'` in it.**
- Key socket-driven refetches on the KIND of change (`nightPulse`,
  `todoPulse`), never on the newest line.

## Fitting the screen

- **Home never scrolls**: every size is a `clamp()` on `dvh`, tight against a
  measured budget (390×667 has ~10px spare). Change one and re-measure; the
  sizes live in Tailwind arbitrary values where a utility sizes a component.
- Above 48rem home is two columns.
- A row is never under 44px; the day and hour never under 2rem.
- **A grid column is `minmax(0, 1fr)` (`grid-cols-1`), never implicit
  `auto`**, and labels in rows are `min-w-0 truncate`. The words give way
  before a count does.
- A sheet's chrome gives way first; content scrolls. Questions keep only today
  on the first screen; the week puts past weeks on a tab; Settings folds the
  creator's controls behind `room-owning`. Settings fills a 667px phone to
  the pixel — measure as a joined dad AND as the creator, in both languages.

## The conversation is what a dad typed

- **The room writes no lines.** The old `say()` (the room's own voice) and
  `/announce` are gone; `say` in `room/lines.ts` now posts what a dad
  typed. Each fact has a screen of its own.
- Screens that need to look again get a `stir` frame (`night`, `todo`,
  `table`). **A stir belongs on a WRITE, never a GET.** An open sheet re-reads
  on the stir.
- Push notifications are not the conversation and are untouched.
- `said.ts` and `meta` stay, to render old lines.

## Shape of the room

- **The room is the conversation and the call.** No tab strip. Anything above
  the list must earn its row.
- Everything else is behind the one Menu button; each is a `Sheet` that
  mounts on open. The Menu's mark is about YOU only, said in words
  (`/api/todo`).
- The conversation's header: room name (display face), faces, `nightShort`.
  **`connection` is a button named "N here" laid OVER the faces**
  (`absolute -inset-2.5`); nothing in a face is part of its name.
- The table stays mounted once opened (`data-table="open"`): half each above
  64rem (room widens to 74rem), the room's place below. The conversation
  keeps a 44rem measure.
- e2e `open(page, …)` matches menu items with an anchored regex.

## Finding a line

- `GET /api/search?q=` reads D1, only `chat` and `prompt`. **LIKE, not FTS5**;
  `%` and `_` are escaped (a test pins it).
- `src/shared/highlight.ts` splits, never substitutes.
- A result goes nowhere; a photo on a result has no `onOpen`.

## Who's here

- Coming and going is `presence` in D1 (`notePresence`), never the tail. Read
  behind "N here": roster, then the log behind `comings`.
- `PUT /api/me/name` writes D1 then re-stamps his open sockets. A face change
  says nothing.
- **A face is NOT a `media` row**: one R2 object per dad at
  `faces/<group>/<member>`, key on `members.avatar_key`. `avatar_at` is a
  version in the URL (`immutable`, `private`). Cropped to 320 in the browser
  with NO fallback.
- **The message row is `2rem 7.5rem 1fr auto`, every cell placed by hand.**
  A face once per run; the room's own lines start in column 2.
- **Faces come from `hello.members`, not the message.** **`Face` looks a dad
  up itself** (members context, member id only; `photo` prop for a picture not
  yet in the room).
- A dad with no photo is his colour (40% into `--bg`), his glasses and a
  smile. No letters.
- The call is read here too (`data-on-call`).

## Dad-night reminders (push)

- Optional: no VAPID secrets → `/api/push` 503 and no toggle. `npm run vapid`.
- `src/worker/push.ts` is ported from jaffre (VAPID ES256, RFC 8291 on
  WebCrypto) — `web-push` cannot run on Workers.
- Per device, per dad, never on by default (`push_subscriptions`, keyed on
  endpoint). 404/410 prunes.
- **An endpoint must be https.** **Google's hosts are matched by SUFFIX and
  narrowed by path `/fcm/send/`** — do not re-tighten to the documented host.
- Proving it needs `launchPersistentContext` headed with notifications
  granted.
- `public/sw.js` shows the notification and focuses a tab; it caches nothing
  and intercepts no fetch.
- iPhone: only from the home screen (`pushShape()`).
- The day-before nudge carries `rsvp-in`/`rsvp-out` (`RSVP_ACTIONS`, pinned —
  `sw.js` matches the strings by hand); the worker shows only actions it knows.
- **Home offers the reminder once per phone** (`RemindOffer`), right after an
  answer that is not "Can't", in the place of the night's quiet row. Yes or
  "not now" sets `dads.remind.asked`; it is Settings' same subscription.
- **"Something's on"** (`room/live.ts`): the first dad picking up the call
  (nobody → somebody) and a dad sitting down at the table (`seated`) push to
  that same subscription, everybody but him, then that kind is quiet for 30
  minutes, stamped in the DO's `meta` before the first await.

## Small things that turned out to matter

- New lines follow him down only if he was at the bottom (`counted` is a ref).
- "New since you were here" is ONE divider (`toRows` with `since`), never at
  the very top; the mark is per device, nothing sent.
- The tab title carries the unseen count.
- **Links are split, never substituted** (`linkify.ts`, http(s) only);
  `shortLink` never cuts the host; links are underlined.
- A photo in the list is capped at 16rem tall, 20rem wide.
- The screen stays awake on a call (`useWakeLock`, retaken on return).
- Speaking is worked out locally (`speaking.ts`), merged into `peers` late.

## Media

- **A voice note is the composer's point**: with nothing typed it offers the
  mic, otherwise Send, never both. `recorder.ts`: two minutes, under half a
  second discarded, track always stopped; container list tried in order. No
  caption, no confirmation.
- Inline allowlist includes audio and `video/mp4|webm|quicktime`. **HEIC is
  deliberately not.** **`image/svg+xml` is never inline**; anything off the
  list is `octet-stream`, `nosniff`, `attachment`. Do not widen it.
- Cap 25 MB.
- `getUserMedia` asks for echo cancellation, noise suppression, gain by name.
- **A photograph opens IN the app** (`Viewer.tsx`, Radix Dialog), holding the
  conversation's photos from `room.messages`. Save tries the share sheet
  first; `AbortError` is not a failure. Black ground, `contain`. Video and
  voice are not in the viewer.
- **A man may only attach what he uploaded, and a picture belongs to ONE
  line** (sender compared on the way in).
- **Two shelves**: ten pictures, thirty voice notes, partitioned by stored
  content type; the oldest of that kind goes, blob and record.
- **A photograph can be kept** (`media.kept`, exempt from pruner and count,
  `KEPT_PER_GROUP` 20 → 409). Any dad may keep any picture. **Not
  optimistic**; the pin appears on the `kept` frame. Letting go puts it back
  on the shelf as the oldest. "Stays" is not "Save".
- Images shrink in the browser (1600, JPEG 0.82), falling back to the
  original on any failure.
- **R2 objects are never public**; served behind the session, scoped to the
  group. A failed record write deletes its blob. Attachments are hydrated from
  D1, never stored in the tail.

## Public facing

- `public/icon.svg` is the artwork; `npm run icons` renders the rest (with
  Playwright's chromium), committed.
- Manifest, `robots.txt` and `noindex` meta.
- **Security headers live in `public/_headers`**, because the assets binding
  answers before the Worker for everything but `/api`, `/ws`, `/i`. Pinned by
  an e2e.
- `theme-color` is the real `--bg`; `theme.ts` keeps an explicit choice in
  step.
- The door carries the language toggle (`LangToggle compact`).
- An `.ics` `SUMMARY` goes through `icsText`: anybody names a room.

## From the home screen

- **The first paint is `index.html`'s `#shell`** (the splash's opening, styled
  in `tokens.css` on tokens). `App` drops it (`shell.ts`) in a LAYOUT effect
  once the session is known; the splash skips its face's pop when it takes
  over. It catches no pointer, so only `home.spec`'s shell test would notice
  one that never left.
- **A home-screen app is woken, not loaded**: `useFreshBuild` compares
  `bundleOf` on return (at most once a minute, never while he is busy, never
  on a cold load). Covered by `e2e/fresh.spec.ts`.
- **`main.room` is `var(--app-h, 100dvh)`** kept at the visual viewport by
  `useVisualViewport`; Android gets `interactive-widget=resizes-content`. Do
  not go back to a bare `100dvh`.
- **Text fields are 16px** (`text-base`), or iOS zooms.
- **Send keeps the keyboard** (`onMouseDown` preventDefault, refocus).
- `overscroll-behavior: none` on html/body, `contain` on the list and sheets,
  `touch-action: manipulation`; pinch zoom left alone.
- A thumb is 44px; `prod/screens.spec.ts` refuses under 28px.
- `e2e/a11y.spec.ts` runs axe over every scene in both themes.

## The talk column is flex, not grid rows

- `.col-talk` is a flex column and `.lines` takes `flex: 1`; nothing in it may
  depend on how many children exist.

## CI

- `ci.yml`: format, lint, typecheck, contrast, unit, build on every push; no
  browser.
- `e2e.yml`: after CI on main, nightly, on demand.
- **Every green push to main deploys** (`migrate:remote`, `deploy`, then a
  check the live door names the new bundle), switched by `DEPLOY_ENABLED`.
  A migration goes live on merge; one that needs a hand (backfill, rename)
  means setting `DEPLOY_ENABLED` false first.

## The room on a phone

- **The header is structurally incapable of overflowing**: `min-width: 0` on
  the left, `flex-shrink: 0` on the actions, `main.room` `width: 100%` with
  `overflow-x: clip`. Icons below 48rem in every language — do not trust a
  breakpoint with this.
- Safe areas on all four sides (`viewport-fit=cover`).
- A message on a phone is two rows; a run drops the repeated name and clock.

## Proving it in production

- `npm run prove` runs `prod/` against the live site, not in CI. **It has a
  room of its own**, "The Prove Room" (`prove-room`); its word is `PROD_CODE`
  in `.dev.vars` beside `OPS_SECRET` (`prod/devvars.ts`) and nowhere else. Lost
  `.dev.vars` → `npm run group:create -- --slug prove-room --rotate --remote`.
  **The room's name must never start with `prove-`.**
- It proves the deployment. It reads the group's switches from `/api/me` and
  skips what is off. It never moves the night.
- **Cleanup must reach the DO's tail too** (`POST /api/ops/forget`, LIKE
  pattern, ≥4 chars, gated on `OPS_SECRET`, 404 otherwise).
- Every invented dad is `prove-<what>-<run>`; everything said goes through
  `note()` with the same marker.
- In `screens.spec`, `aria-hidden` subtrees and out-of-flow overflow are not
  faults.

## Test layout

- **A line's text runs into its clock**: zero-pad numbered lines; beware any
  needle ending in a digit.
- Two browsers: Chromium for everything, `webkit-iphone` only for
  `e2e/safari.spec.ts` in its own room. No codec questions on WebKit.
- **A fixed `settle()` before an assertion is a race.** Use `until`
  (`test/helpers.ts`), counted in tries. Prove a negative with a sentinel
  frame. `enter()` waits for `hello`. `tick()` spins forever where `Date` is
  faked.
- vitest storage is per FILE: `resetTables()` in `beforeEach`.
- e2e `global-setup.ts` recreates one group per spec file (and clears
  `join_attempts`); tests sharing a group are `serial`. A spec that needs a
  creator opens its own room from its own `CF-Connecting-IP`.
- DO alarm tests fake only `Date`, and **alarms must be armed at real-future
  instants** (`upcomingNight()`); a waiting helper never reinstalls fake
  timers.
- **Pure logic lives outside components** so the worker pool can import it
  (listed in `tsconfig.worker.json`); take browser globals as typed accessors.
- Anything that shells out goes through `scripts/run.ts`.
