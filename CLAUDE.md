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
  and an `error` frame drops the line it NAMES — a body the room refuses
  would otherwise be re-sent all evening.
- **A refusal names the line it is about.** `error` carries the sender's
  `cid` back when the refused frame had one, and the outbox drops that line
  and no other. It used to drop the oldest one in flight, which was only ever
  a guess dressed as a rule: everything a dad can send is refused with the
  same handful of codes, so a refused EDIT — or a prompt answer with no
  question behind it — quietly threw away a chat line that was perfectly good
  and would have gone through on the next try. A refusal with no name on it
  now leaves the outbox alone.
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
- **The ordinary chat things** (2026-09-16), each the plain version and no
  more: an emoji button in the composer (thirty-two, no search, inserted at
  the caret, offered only where there is a mouse — a phone's keyboard is its
  own picker and a fourth control on the row is three); a mark without the
  long press (a small button at the end of the line under a pointer, and a
  double click on the words is a thumb where there is a mouse); Reply on any
  line a dad typed; Edit on his own. `MarkRow` in `Marks.tsx` is the one row
  of five, shared by the long-press menu, the quick button and the tap row.
- **On a phone, one tap on a line opens the five under it** (2026-09-22).
  The long press was the only way in and nobody finds a long press; the
  double tap gave a thumb and nothing else. Where the pointer is coarse, a tap
  on the words (not a link, a photo, a control, or while words are selected)
  opens `tap-marks` under the line, 44px each, and a tap on one is the choice.
  The double tap is retired on a phone — the first tap of it would open the
  row — and stays as a double CLICK for a mouse, where a single click is a man
  selecting text. A mark vibrates (`buzz.ts`) where Android lets it.
- **A reply carries a SNAPSHOT, not a reference** (migration 0017,
  `messages.reply` and `tail.reply` as JSON `{id, name, body}`). The original
  may scroll out of the backfill, be taken back or be changed afterwards, and
  the quote should still say what he was answering. The room resolves the id
  — tail first, then the archive joined to `members` for the name — cuts the
  words to `REPLY_QUOTE_LENGTH`, quotes only what a dad typed, and posts the
  line WITHOUT a quote when the id is nothing: his words are the thing and
  the quote is the context. A quote goes nowhere on a tap, for the same
  reason a search result does.
- **A quote survives an edit and does NOT survive a retraction.** The snapshot
  exists so it can go on saying what he was answering; the one case where
  surviving is wrong is a line taken BACK, because the words would be on every
  screen again under somebody's answer, and "then it is gone" has to mean
  gone. `unquote()` clears the stored quote in the tail and the archive,
  matched on the id inside the JSON, and every open socket works it out from
  the `gone` frame it already gets — no frame was added for this. The answer
  keeps his own words and loses the context, which is what a retraction costs
  everybody.
- **Editing has retraction's authority and retraction's honesty.** His own,
  only `chat` and `prompt`, checked in the archive first and the tail too;
  never to nothing. Not optimistic: an `edited` frame goes to everyone, the
  editor included, and the composer's field keeps his words until the room
  took them. **"Took them" means the line came BACK changed**, never that
  `ws.send` did not throw — that is the same dead-spot socket the outbox
  exists for, and clearing the field on a send that went nowhere left a man
  looking at the old words with his new ones gone. The edit waits
  `ACK_GRACE_MS` for its own line; unanswered, he keeps what he typed, the
  composer says so, and pressing Send again is the whole retry. `edited_at` is the one fact kept; the words before it are not.
  **A socket that resumed rather than reloaded is not told about an edit it
  missed** — the backfill is by seq, and an edit does not move a line's seq.
  A reload gets the tail, which has the new words. Rare enough to leave, and
  written down here so it is not a mystery.
- **Reply and Edit are the composer's state, held in `Room`**, never both at
  once: the line menu sets one and clears the other, the composer shows a
  strip above the field saying which, Escape or the X clears it, and the
  focus call is deferred a tick because Radix hands focus back to the line
  when its menu closes and would land on top of it.
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
- **A night either repeats or happens once, and `date` is the whole
  difference** (2026-09-17, migration 0018). `DadNight.date` is a civil date
  in the group's zone — "2026-09-24", never an instant, for exactly the reason
  the weekday is one — and a night that carries one does not repeat. One field
  rather than a `repeats` flag beside a date: a weekly night has no particular
  date and a one-off has exactly one, so there is nothing to keep in step.
  `weekday` is DERIVED from the date on the way in, so the two halves of
  "Thursday the 24th" can never disagree and arm the room for the wrong
  evening. This reverses PLAN.md's "recurring slot": the standing night is
  still the best mechanism and still the default, but a group whose weeks do
  not look the same had no way to arrange one here, so it happened in another
  app and the room found out afterwards.
- **`stillToCome(night, now)` is the test, not `night === null`.** A one-off
  is still in the group's row the morning after it happened; a screen that
  answered "Thursday" the day after Thursday would be the app insisting on a
  night that is over. Nothing is cleared when a one-off passes — `nextStart`
  simply returns null, `occurrenceOf` with it, and the group is a group being
  asked when the next one is. That is also why nothing races: no write, no
  frame, no alarm.
- **The calendar is the poll, and there is no poll table** (`night_votes`).
  A poll is open exactly when there is no night still to come, which the
  group's own row already answers — one less thing that can fall out of step.
  Any dad marks any day on a month he can page forward through; the cell IS
  the control and a tap cycles can → might → can't → nothing said, which is a
  different thing from "can't". Locking a day in writes the night through the
  same `writeNight` the editor uses and deletes every vote: a date is only
  picked once.
- **Marking the calendar says nothing in the room.** Five dads marking a
  fortnight is sixty lines about one decision, which is how a conversation
  becomes a calendar. Nothing about the poll is said at all now — not its
  opening, not the date being locked in (`poll_open` and `night_set` survive
  in `said.ts` only to render old lines; see **The conversation is what a dad
  typed**). Everyone looking at the calendar right now finds out through a
  `poll` frame, which is a nudge to re-read and not the marks themselves.
- **Any dad locks it in, and no rule does it for him.** Same as the night:
  there is no admin over what a group decides together, and a rule that picked
  the leader at some hour would be deciding a tie, or a late vote, on behalf
  of men who are all in the same conversation and can simply say. (The three
  switches are no longer an example of this — since 2026-09-17 they are the
  room creator's. What a room IS and what a group DECIDES are different
  questions, and only the first one has an owner.)
- **An arranged evening is edited AS a date, and can be called off.** The
  weekday dropdown is the right control for a standing night and the wrong one
  for one evening: it cannot say "the 28th", so saving from it turned
  Thursday-the-28th into every-Thursday and the group lost the thing they had
  agreed. The editor shows a date field when the night has a date, and the
  server derives the weekday from it rather than believing two fields that can
  disagree. **"Can't do that night" is the way out**, armed like taking a line
  back because four other men arranged their week around it — and the sheet
  becomes the calendar again in the same breath, because "when is the next
  one" is the question that follows. Without it the group was stuck with a
  date nobody could move until it had been and gone.
- **Calling one off is not clearing the night.** One says which evening is
  not happening; the other is a group that has stopped having a standing
  night. They were two room lines (`night_off`, `night_cleared`) until the
  room stopped writing lines; the difference lives on the card and the sheet
  now.
- **A one-off `.ics` gets no RRULE and its own UID.** An RRULE would put a
  standing Thursday in five calendars off the back of one date they agreed to,
  and a repeated UID asks a calendar to REWRITE the event already in it.
- **An RSVP has three answers now** (`in` / `maybe` / `out`), and so does a
  vote. Two were enough for a standing night — it is Thursday, you are coming
  or you are not — but a night being arranged asks the question of a man who
  often genuinely does not know, and pushing that into "can't" loses the date
  for everybody while pushing it into "in" is a promise he did not make.
  `coming` still rides beside `answer` on the wire, and `PUT /api/rsvp` still
  takes `{ coming }`, because `public/sw.js` answers from the lock screen and
  a home-screen app can go days between reloads.
- **Home's three answers are all on the screen from the start.** The old rule
  — both answers until he has given one, because an RSVP is announced by name
  and a man who cannot come must not have to say he can — is kept by different
  means: three answers cannot be a toggle, so they simply all stay and the one
  he gave is filled in. No icons on that row; three controls across a 390px
  card in French has room for the words or the glyphs, not both.
  **Since 2026-09-22 they are ONE control** (`home-answers`): three segments
  and a thumb that slides to the one he gave, so changing his mind is a thing
  he watches happen. "Can't" is filled in ink, not red — not coming is not an
  error — and `audit:contrast` checks that pair. Beside the names of who is
  coming sit their faces (`FaceStack`); his pops in when he answers.
- **Two consecutive RSVP lines from one dad are one change of mind**, and
  `supersedes` in `messageGroups.ts` drops the earlier — which predates
  "maybe" and is why an e2e cannot expect to find "might make it" after he has
  said he is in. Step into the conversation and look before changing it.
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
- The night is set from home's card, NOT from Settings. Settings is what a dad
  sets once; the night is what the group keeps deciding, and it belongs beside
  the answer to it.
- **The standing-night form is collapsed behind one row** (`night-standing`),
  in both states and for two different reasons. With a night on the books it
  is a thing a dad occasionally changes. With none the sheet IS the calendar,
  and the form REPLACES it when opened rather than joining it, because a
  weekly slot and a day everyone voted for are two answers to one question.
  That is why the open/closed state lives in `Night` and not in `Change`.
- **`getByLabel` matches by substring, and the calendar is thirty labels
  saying "…day".** "Always the same day" and "Thursday, September 10 — …" both
  answer `getByLabel('Day')`. Every label in the night sheet needs
  `{ exact: true }` now, which is the header rule from M8 arriving somewhere
  new. The poll's time field carries no `aria-label` for the same family of
  reason: its visible label is its name, and a name that does not contain the
  words beside it is a control a voice user cannot ask for.
- `night_start` pushes "the table's open" to the phones that asked — nothing
  in the room — and arms `night_end`. **`night_end` does nothing now**:
  `closeDadNight` has been empty since the room stopped writing lines, and the
  closing summary and `poll_open` went with it. It is still armed, because it
  holds the schedule inside the window, so the next firing arms next week's
  start rather than tonight's again. A group with no night arms nothing — and
  a one-off that has just happened is such a group; the card turns into the
  calendar by itself, because `stillToCome` says so.
- Any dad can set the night — no admin role. `PUT /api/night` writes D1 then
  tells the DO, which re-arms and pushes a `night` frame to open sockets.
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

## What the two sheets got wrong

A read of the questions and the week for what a dad meets on first sight
(2026-09-17). Four things, all of them the same mistake in different clothes:
the screen knew something and did not say it.

- **Today's answers are under today's question.** The card said "3 answers."
  and stopped — while a question from March expanded to show its answers. The
  one anybody cares about was the one you had to leave the sheet, walk into
  the conversation and scroll for. They are in `room.messages` already, so
  showing them costs a fetch of nothing.
- **The box under today's question says what it is for.** Answering is behind
  a button, so the only FIELD on that screen was the one that adds a question
  to the group's pool — and an empty box under a question reads as the place
  to answer it. A man's answer became next week's question.
- **The 1–5 says which end is which, on the screen.** Five bare numbers do not
  say whether 1 is a good week or a bad one. The words were there in the
  accessible name only, so a screen reader was told what a sighted dad had to
  guess — backwards, on the most-used control in the app.
- **The week's note field has a visible label**, like the field under it. A
  placeholder is not a label: it goes the moment he types, it is the first
  thing a low-vision setting drops, and the two fields on one short form were
  following two different rules.

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
- **A new table is a new code** (2026-09-22). Jaffre has no reset: a
  finished game stays on the felt, a dad who left keeps his seat and nobody
  can take it, and the only way on is a rematch with four in their seats. A
  room jaffre has never seen starts empty, so `POST /api/table/new` writes
  `freshTableCode` — the slug's prefix and six random hex — over the stored
  code and stirs every open screen (`stir` with `what: 'table'`). Each one
  re-fetches rather than being handed the code, because the link carries his
  OWN name. The old room empties and jaffre's reaper collects it; nothing
  on jaffre's side changed. Any dad may press it, armed on the first press,
  because the men at the table decide whether to start again and a game in
  progress ends for all of them. The random half is also what stops a
  stranger sitting down by guessing the slug.
- **The name is cut to jaffre's twenty** (`tableName`) on the way in, and the
  turn nudge compares on the cut name. A dads name may be 32, and a longer one
  came back on a `turn` that matched nobody.
- `event.origin !== JAFFRE_ORIGIN` is the whole security boundary on the way
  in — any page can postMessage at us, and a table event reaches the room and
  can push to a phone. The matching check on jaffre's side takes the target
  origin from the **referrer**, so a page cannot nominate someone else as the
  recipient.
- Every framed dad relays the same jaffre event to the room. Since the room
  stopped writing lines, the only one it acts on is `turn` (a push to the dad
  it names); the rest are the panel's own `table-note`. `tableSaid` survives
  for its tests only.
- **The table stays mounted; the prompts and board do not.** Unmounting the
  iframe restarts the game; keeping the other two alive shows data that was
  true when the page loaded. The e2e caught that regression — keep it.
- **But it is not mounted until it is first opened** (`tableEver` in
  `Room`). Mounting it for every dad on arrival kept a socket to jaffre open
  from every phone in the room all evening — nobody's game — and meant
  jaffre's reaper never saw the room empty. The frame now relays only for the
  dads who opened it, which is the men at the table and exactly who a `turn`
  is about.
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
- **A control is 44px, and that is the kit's default now** (2026-09-14). `md`
  was 40 while the composer's row, the header's icons and the call's buttons
  each asked for 44 by hand — the number this repo already called a thumb. One
  size, set once. `icon` is the same 44 square; `sm` and `iconSm` survive
  only INSIDE the conversation (the to-bottom pill, the table's head, the
  composer's remove), where a row of chat is what a bigger control costs.
- **`lg` is the one action on a sheet** (2026-09-15): 3.25rem, 17px, on the
  control radius — Save, I'm in, Add, Copy, Come in, and home's answers,
  which were the same button written out by hand. A `FIELD` is the same
  height on the same radius, so a field and the button beside it read as one
  row; it is a `min-height`, because the same class dresses the textarea.
  Everything a dad READS on a sheet or the door is 17px (`text-[1.0625rem]`)
  and its heading 17px semibold; the header's count line and the group's
  name (`text-xl`) keep pace. The conversation is deliberately untouched —
  in there the goal is the most lines on the screen, not the biggest.
- **The menu rows and the switch rows are 64px**, set at 1.125rem, on home's
  control radius, with 22px icons. They are a list a thumb picks from at arm's
  length, usually one-handed, and on a phone they are the whole content of the
  screen. A sheet header is `text-3xl` for the same reason: on a phone it is
  the top of the screen, not the lip of a panel. **The size IS the style** —
  the answer to an empty half-screen is bigger type, not more things on it.
  Checked at 390px in French as well as English: "Mets une soirée de gars" and
  "ta semaine à remplir" are the rows that would overflow first, and a menu
  row does not wrap.
- **One list, one row size.** Language and Theme sit in the same list as the
  three switches and were set smaller; a settings screen that answers three
  questions in two sizes makes a dad work out which is which.
- **Still lucide, considered and kept** (2026-09-14). Phosphor was offered and
  is a fine set, but its weights are reachable here through `strokeWidth`, its
  duotone and fill styles fight a near-monochrome palette, and the swap is 23
  files of renames for no change a dad would notice. The bigger feel came from
  size and spacing, which is where it always was.
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
- **But it moves** (2026-09-22), which reverses "plain" for everything that
  is not words. Played with on a phone it was right and dead: nothing answered
  a press, a sheet appeared rather than arrived. The motion section at the
  bottom of `tokens.css` is the whole of it — one spring, `motion-rise`,
  `-fade`, `-pop`, `-tick`, `-sheet`, and the mark putting its glasses on
  (`Logo motion="on"`, and `"live"` nodding while a night is on). A press
  scales to 0.97. Short, always: a press answers inside 100ms, an arrival
  inside 300. **All of it stops for `prefers-reduced-motion`**, and the a11y
  suite runs that way on purpose — axe measuring contrast mid-fade reports
  half-transparent colours nobody reads. Only lines that ARRIVE ease in; the
  backfill does not, or opening the app is five hundred lines rising at once.
  The `animate-in`/`fade-in` classes that were here before were never defined:
  nothing animated at all until this.
- **The glasses are the app's symbol** (2026-09-23), and every move that is
  more than a press is built on them. `Logo` has three motions (`on`: they
  come down; `live`: they nod while a night is on; `glint`: a light across the
  lenses while something is loading) and `Glasses` is the pair on its own.
  - **The splash** (`Splash.tsx`) plays once per load over the room, which is
    already connecting underneath: the face, the glasses coming down, then a
    zoom into the left lens until it is the whole screen. The lenses are cut
    through the ground with an SVG mask, so the app is what shows through
    them, smoked until the zoom lifts the tint. `pointer-events: none` and
    `aria-hidden`, so nothing waits on it — not a dad, not a test.
    **Two rules it learned the hard way.** It is ONE screen-sized SVG in which
    only the mark scales: scaling a whole SVG with a big ground in it past a
    hundredfold zoom ran Chrome out of tile memory and crashed ten e2e specs.
    And it is driven frame by frame from JS (attributes set in a rAF loop),
    not CSS: Chrome does not reliably repaint an SVG MASK whose contents move
    by CSS animation, and the see-through holes lagged the drawn glasses.
  - **"Go and talk" is a zoom into the glasses** (2026-09-23): the same
    splash, started exactly over the mark on the door's button (`Splash from`)
    and already wearing its glasses; the page goes to the button's blue around
    it and the camera flies into the left lens, with the conversation — already
    switched to underneath — showing through it. DRAWN, not a view transition:
    a snapshot of a 32px mark zoomed twenty times is a blur, which is what the
    first version was. **The way back** is a view transition (`lens.ts`), home
    scaling down from the lens while the chat is clipped into it, because it
    needs both screens at once; its lens is remembered from the way in, since
    by then home is hidden and has no box. No view transitions (Firefox), or
    reduced motion: it simply changes.
  - **A dad who is in wears them**: his face in home's stack has the glasses
    dropped on it. A maybe does not, yet.
  - **Typing is a pair bobbing** beside the names, with the sentence sr-only.
  - **Waiting glints**: the header while the room opens or reconnects, and the
    "…" of who is coming (the words stay "…", which a test pins).
  - **An empty room is the face**, putting its glasses on above "nobody has
    said anything yet".
    All of it, splash included, is absent for `prefers-reduced-motion`.
- **Home's menu is one grouped list** (2026-09-22): the list draws the border
  and the hairlines, a row (`ROW` in `Menu.tsx`) carries no box of its own,
  and its focus ring sits INSIDE the row because the list clips. The door and
  the rows are one block (`home-actions`), so a tall phone has one gap — between
  the night and the way in — instead of two. `ITEM` stays for the boxed rows
  elsewhere (`MyRooms`, `Questions`).
- **The door's language is a small pair in the corner** (`LangToggle compact`),
  still named EN and FR.
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

- **The app opens on home** (2026-09-12), not in the conversation. The first
  question a dad has when he picks up his phone is not "what was said": it is
  when the night is, and that used to be a countdown that only appeared inside
  24 hours.
- **Home asks ONE question** (2026-09-14): are you coming on Thursday. The day
  and the hour stacked in the biggest type in the app, how far off it is, who
  has said yes, one button to answer with — and then a door into the
  conversation, because talking is what the night is for. It was two blocks
  before that and four before them; a screen that asks two questions gets
  neither answered. Who is about came off it (the header counts them, and that
  count is the way into the roster) and so did what is waiting for HIM, which
  lives behind the Menu button and carries its own mark. Anything proposed for
  this screen has to displace the night or the door, not join them.
- **With no evening to come, the ONE question becomes "when's the next one?"**
  (2026-09-17). The card keeps its shape, its size and its type: a group with
  nothing on the books has the same question as a group with a night, a louder
  one if anything, and the old "No dad night yet" was a whisper. It shows the
  two days the most dads can do, and its one button opens the calendar. The
  MONTH GRID itself stays in the sheet — it is the right way to answer this
  and the wrong thing to put on a screen that has to fit a 667px phone with a
  door and four menu rows under it.
- **The menu is on home** (2026-09-15), under the door, in what was empty
  space: the same `Menu` component the conversation shows in a sheet, and
  **which rows it holds depends on the screen**. Home holds the SHORT menu —
  Questions, The week, Invite, Settings — and the conversation holds the FULL
  one: those four plus the table and Find (2026-09-16; it used to hold only
  the talking rows, and a man told "your week to fill in" mid-conversation
  had to walk back out to do it). A man on home is one tap from the
  conversation; a man in the conversation should not have to leave it for
  anything.
  **There is no Dad night row anywhere**: home's card IS the night
  and always carries its own way into the sheet (`dad-night` on the card's
  quiet link, or on "Set dad night" when there is none). This is the one
  exception to "displace the night or the door": the rows sit below both and
  take nothing from them. `Home` takes the menu as a `menu` ReactNode, so
  it knows nothing of the menu's props. e2e: `menu(page)` presses Menu only
  where there is one, `home(page)` is `talk`'s mirror, and `night(page)`
  goes home and opens the card (`e2e/talk.ts`; `prod/names.ts` has
  `home`). A spec opens home-side things from home and chat-side things from
  the chat, and steps back into the conversation before asserting on a line. **The rows are in the tree only
  while home is the screen showing**: home stays mounted behind the
  conversation, and `getByTestId` does not care about `display: none` — with
  the menu sheet open, `dad-night` and `mark-board` matched twice and four
  specs died on strict mode.
- **The card is the one place the app is not square.** `--radius-card` and
  `--radius-control` against the app's own 4px: a screen with a single thing on
  it reads as being ABOUT that thing when the thing has an edge. The surface is
  `--bg-soft`, the same panel the composer and the sheets use — no new colour,
  and `audit:contrast` already checks text and muted on it in both themes.
  **The shapes are passed as Tailwind classes, not as CSS**: utilities are
  layered after the hand-written sheet, so `rounded-app` on the Button would
  beat a `.home-go { border-radius }` rule. `cn` resolves it the caller's way.
- **The display face touches a fourth thing**, and the first that is not a
  name: the day and the hour on home. It was the door's wordmark, the group's
  name and a sheet's title. Still nothing a dad reads a SENTENCE of.
- **Both answers until he has given one, then a single button showing what he
  said.** Pressing it changes his mind. Not a toggle from the start: an RSVP is
  announced in the room by name, so a man who cannot come must not have to say
  he can and then take it back — that is two lines in the conversation about
  one evening. What the press does is in the accessible name, never on the
  screen; a label explaining a button is a button that needed explaining.
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
- **The header has two shapes, split on the view** (2026-09-15). On home it
  is the group's name and the head-count and nothing else: the menu is on the
  screen below and the call is joined from the conversation. In the
  conversation it is one slim row: the way back, the head-count and the night
  line as the only information, and the call and the Menu as plain 44px icons
  with their words sr-only. The group's name is still the page's h1 there,
  only `sr-only` — he came in from a screen that said it in the biggest type
  in the app, and every row the bar takes in the conversation is a row of
  conversation it costs.
- **The table is offered only from the conversation.** The menu's item is
  gated on `view === 'talk'`: the table takes the room's place on a phone
  and sits beside it on a laptop, and from home there is no room for it to
  take. e2e that opens it must `talk(page)` first.
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
- **The door carries the app's own mark** (2026-09-16), and nothing else on
  the screen does. It was a filled bar with a word on it, exactly like "Set
  dad night" in the card above, and read as one more answer. Now it is the
  shape of the rows under it — mark left, words, arrow right — taller, and
  the only one filled. `Logo.tsx` is `icon.svg` minus the square: the face
  in `currentColor`, the glasses cut through to a `hole` the caller names, so
  on the primary button it is the text colour with the fill showing through
  and needs no colour of its own. The artwork's fixed hexes would have put a
  pale face on the pale-blue accent dark mode uses. Decorative, `aria-hidden`:
  the words beside it are the name.
- **In an empty room the mark starts at nought once the room has said
  hello.** `useSeen` takes `ready` (`connection === 'open'`) for that. It
  used to wait for a line to anchor to, and that line became the mark — so
  the first thing ever said in a group was the one thing the door never
  counted. The first test in `home.spec.ts` pins it, first because the group
  is empty only once.
- **A new line is unseen unless the conversation is on the screen.** `watching`
  is `view === 'talk' && !tableOpen`. The table used to fall through that
  check and count nothing at all.
- **Home is a LIVE screen, and the night is part of what is live.** Presence
  comes off the socket, but the night was fetched once at mount, so a dad
  sitting on home watched the list of who is coming go stale while the room
  said otherwise a foot below. It re-reads on the newest `rsvp` or
  `item_added` seq — that kind of line, not any line, because a chatty evening
  is not a reason to re-read the night thirty times.
- **Home never asserts a fact it has not been told.** Who is coming is fetched
  rather than pushed, and home paints before the answer lands — so nothing at
  that moment means "I do not know", and printing "Nobody has said yet" is the
  app inventing bad news about turnout and correcting itself a second later.
  It shows `…` instead, which is the vocabulary the roster sheet already uses.
  The same rule once covered the roster on home, back when home had one.
- **The header does not repeat what home says.** The night line is hidden on
  home, where the same thing is the first item on the screen at four times the
  size — and since the menu moved onto home, so are the Menu and call buttons
  and the mark: the rows are on the screen, and each says in words what is
  waiting on it. The mark is on the Menu button in the conversation, where
  the rows are behind it and hiding it would leave him no sign at all.
- **Who is coming reads at ink**, under the day and the hour: it is the thing
  that actually decides turnout, and it was the same grey as everything else.
- e2e: `talk(page)` (`e2e/talk.ts`, and `prod/names.ts`) steps into the
  conversation and is idempotent, because these suites walk through screens
  and it must not matter which one the last step left him on.

## A room of your own

- **Anybody at the door can open a room** (2026-09-17), which reverses
  PLAN.md's "group creation is a seeded script/CLI, not a public flow".
  `scripts/create-group.ts` stays — it made the real group and it is how a
  code is rotated — but it is no longer the only way a room exists. What that
  costs is that this app is now open to whoever finds the address, and three
  things pay for it: three rooms per address per day (counted in
  `join_attempts`, its own bucket so a wrong code and a new room cannot lock
  each other out), a four-character floor on the word, and the word being
  unique across every room.
- **The word is a fingerprint now, not a scan.** Joining used to run a
  100,000-iteration PBKDF2 against every group in turn until one matched,
  capped at fifty. With one room that is one derivation; with rooms anybody
  can make it is two failures waiting — past the fiftieth room a dad with a
  perfectly good word is told it opens nothing, and every wrong guess costs
  fifty derivations. `invite_code_lookup` is the normalized word HMAC'd with
  the Worker secret, UNIQUE, so a word finds its room in one indexed read and
  PBKDF2 only verifies. Keyed rather than plain for the reason the IP buckets
  are: a bare hash of a short human word is a dictionary attack against a
  stolen dump.
- **A room LEARNS its word on the first join, rather than being told it.**
  The fingerprint is keyed with the Worker's secret, and `create-group.ts`
  runs on a laptop that does not have production's — a secret you cannot read
  is the whole point of one. So rooms made by the script carry NULL, the
  bounded scan still finds them, and the first correct word anybody types
  writes the fingerprint for next time. Do not "fix" this by putting the
  production secret on a laptop.
- **Two rooms cannot share a word.** The door takes a word and nothing else,
  so a duplicate would hand a dad who typed the right thing a room full of
  strangers — the old scan gave him whichever row came first. The second room
  is refused, both by a SELECT for the clear message and by the UNIQUE index
  for the two that raced.
- **The door offers it under the question, never beside it.** Nearly everybody
  who loads that page was sent a word by a friend, and the screen should ask
  the one thing they came to answer. A dad who followed an invite LINK is not
  offered it at all: he is already being let into somebody's room.
- **Opening a room lets him in on the same submit.** The room, its first
  member and the cookie are made together. Asking a man to type the word he
  invented thirty seconds ago is asking him to prove he is himself.

- **The word is the creator's to change, and the room is his to hand on.**
  Owning the switches without those two was half a feature: a word that got
  out could be changed by nobody in the room — the only rotation was a script
  on a laptop with the repo on it — and a creator who drifted away froze the
  switches for the other four for ever. `PUT /api/rooms/word` and
  `PUT /api/rooms/owner`, both creator-only, and neither says anything in the room.
- **The app can never show the current word**, here or anywhere: it is kept as
  a PBKDF2 hash and nothing knows the plaintext, which is the same reason an
  invite link carries its own secret. The form only ever SETS a new one, and
  the line in the room says the word changed without saying what to.
- **Changing the word kills the invite links that were out.** They are a
  separate secret and rotating the word does not technically touch them — but
  a man changing the word is closing a door, and leaving keys on the step that
  still open it would make the feature a lie. Everything else survives, as
  `--rotate` has always promised: the members, the archive, the board.
- **Handing it over is one way.** Once it is his, getting it back is him
  handing it back, which is the honest shape for a thing exactly one man
  holds. The client arms the button and puts his NAME in the confirming label,
  so the second press is about a person rather than a control.
- **Who owns it rides the socket, like the switches do.** An `owner` frame,
  seeded from the session and kept current after — the man it was handed TO
  must not have to reload to stop being told the switches are somebody else's.
- **A genuine arrival broadcasts a `member` frame.** `members` — everyone in
  the group — was only built at hello, so a dad already connected when
  somebody new came through the door did not have him until a reload: no face
  beside his lines, and not in any list of the group's men. Found by the
  handover picker being empty.

- **A phone can be in several rooms, and always could.** The device token is
  looked up per GROUP, so joining a second room never cost a dad the first and
  typing the first one's word again brought him back as himself with all his
  history. What was missing was any way to know which rooms he was in, or to
  get back without that word written down somewhere.
- **The device token is what proves it**, here as at the door: 256 bits this
  Worker issued, stored only as an HMAC. A browser holding one IS the man who
  joined, so switching needs no password and cannot reach a room he was never
  let into. `POST /api/rooms/mine` lists them; `/switch` mints the cookie for
  one of them and 403s for anything else, with no hint that it exists.
- **Switching RELOADS.** The socket, the session, the seen-marks, the night
  and every screen read from them are keyed to the group; starting again is
  the honest way to change all of it at once, and it costs what a tap costs.
- **The sheet is also the only way to GET another room.** A man already inside
  cannot reach the door, and both "start a room" and the word field live on
  the door — so they live in here too. Without that, the feature was a list
  that could never grow past one.
- **The row is in the conversation's menu, not home's.** Home holds the short
  menu and a fifth row there puts the door off the bottom of a 667px phone,
  which `e2e/fit.spec.ts` measures. It is present with ONE room, unlike the
  count beside it, because adding is what it is for.
- **A man may go by different names in different rooms**, and the list is the
  one place both are on screen: the room he is in says "you're here", the
  others say what he is called there.

## The three switches

- **The three switches are the CREATOR's** (2026-09-17), and this reverses
  what stood here: they were any dad's to change and nobody's to own. They
  decide what the room IS — whether it asks a question every day, keeps a
  week, has a table in it — and a man who opened a room for a purpose should
  not have that purpose changed by whoever wandered in. It is still the
  GROUP's setting and not each man's: two dads seeing different menus is how
  a group stops sharing a room. What changed is who holds the switch.
- **A room with no creator keeps the old rule exactly.** `created_by` is NULL
  for every room made before rooms had creators, and for those the switches
  stay everybody's. That is not a gap to close later; it is what those rooms
  agreed to, and the real group is one of them.
- **The night, the board, the poll and keeping a photograph are NOT this.**
  There is still no admin for the things a group decides together — when to
  meet, what to try this week, which photograph survives. Ownership reaches
  exactly as far as what the room is made of, and no further.
- It is announced to nothing — a switch is not news, and the change reaches
  every open socket anyway.
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

## Fitting the screen (2026-09-16)

- **Home never scrolls, and neither does a sheet that can help it.** Every
  size on home is a `clamp()` on `dvh` — the card's padding, the day and the
  hour, the answers, the door, the menu rows and every gap — so the three
  blocks fit a 667px phone with nothing cut off and still fill a 932px one.
  The multipliers were set against a measured budget (`scrollHeight` against
  `clientHeight` at 390×667, 390×844, 430×932, 1280×800, 1024×600 and 844×390)
  and are tight: the small phone fits with about ten pixels to spare. Change
  one and re-measure; `overflow-y: auto` on `.home` is the safety net, not the
  plan. The dvh sizes are in Tailwind arbitrary values
  (`h-[clamp(2.75rem,6dvh,4rem)]`) where a component is sized by a utility,
  because a utility beats a layered rule.
- **Above 48rem home is two columns**: the card on the left, the door and the
  rows on the right. Three things stacked in one 34rem column cut the last row
  off a 1280×800 laptop with half the screen empty either side.
- **A row is never under 44px** (`2.75rem` is every row's floor), and the day
  and the hour never under 2rem. Below that the fit is the scroll's problem.
- **A grid column is `minmax(0, 1fr)`, never the implicit `auto`.** An auto
  track takes the width of its widest child, and nothing in a menu row or a
  sheet row wraps — so one long row in French on a 360px phone made the whole
  nav, and the questions sheet, wider than the screen. `.menu` and the
  questions grid both say it out loud now, and every label inside a row is
  `min-w-0 truncate` so the WORDS give way rather than the layout. The same
  rule the header has had since M8, in the two places that had not learned it.
- **A row with a count on it is wider than the same row without one.**
  The questions' "what was asked before" fit a 360px phone in French until
  the group had been asked anything, and then it did not: a button never
  wraps, so the row made its grid wider than the sheet and took the form
  above it off the right-hand edge. The grid is `grid-cols-1`
  (`minmax(0, 1fr)`) so a child can never widen its own container, the row's
  WORDS truncate before the count does — the count is the reason anybody
  looks — and the e2e fixture has three days of questions behind it, because
  a group that was never asked anything cannot show this.
- **A sheet's chrome gives way first.** The title and its padding are clamped
  on dvh in `Sheet.tsx`; the content area still scrolls, because a list of
  everyone's week or every question before today can always be taller than a
  phone. What each sheet does to fit: the questions keep only TODAY on the
  first screen and put what was asked before behind one row with the count
  on it (`Questions.tsx`, `prompt-history`, with `prompt-today` as the way
  back); the week puts the weeks behind this one on a tab (`ui/Tabs.tsx`,
  Radix, inside a sheet only — the "no tab strip over the room" rule stands)
  and sits Save beside the last field; settings puts the face beside the name
  with the label sr-only. Both were measured at 390×667 in both languages.
- **The week says what it is.** One line under the title, and "Everyone, this
  week" over the rows: "The week" on its own was a title a dad had to work
  out, with a form and a list that did not say whose they were.

## The conversation is what a dad typed

- **The room writes no lines** (2026-09-17). It used to narrate itself: every
  RSVP, every check-in, every promise and how it went, every thing put up for
  the night, every seat taken at the table, a name changing, a night being
  set. In a week of five men that was twenty-odd lines the room wrote about
  itself against however many they actually typed — and every one of them had
  a screen of its own already. `say()` is gone, `/announce` is gone, and the
  conversation is messages and media.
- **Where each of them went**, because "we have views for them" is only true
  if it is checked: who is coming is home's card and the night sheet; what is
  up for the evening is the night sheet; the week is the week, with a mark on
  the menu row when his is empty; the night being set or moved is the card and
  the header; who is who is the roster behind the head-count; the table is the
  table, on screen beside the room; the word and the owner are Settings.
- **The lines were doing TWO jobs, and only one of them was news.** The other
  was telling the screens to look again — home read `rsvp`/`item_added` off
  the message list, and the marks read `check_in`/`commitment`/`outcome`.
  That half had to stay, so it is a `stir` frame carrying nothing but which
  kind of thing changed. Take one away and home sits there showing who was
  coming an hour ago.
- **A stir belongs on a WRITE.** One on the GET that reads the night told
  every open phone to read again, and their reads told each other, until
  Chrome started refusing to make requests (`ERR_INSUFFICIENT_RESOURCES`) and
  every fetch in the sheet was cancelled by the next one.
- **A sheet that is open has to keep up now.** The night sheet used to be read
  once and left: a dad with it open watched the others answer in the
  conversation instead, because the room said so in words. It re-reads on the
  stir, which is what makes "the views have it" true rather than nearly true.
- **The push notifications are NOT the conversation** and are untouched: the
  day-before nudge, the table's open, a turn left sitting. A line in the room
  and a phone buzzing in a pocket are different things, and it was always the
  second one that reached a dad who was not looking.
- **`said.ts` and the `meta` column stay**, unreachable for anything new.
  They render a line from an archive written before this, and they are what a
  single line would be rebuilt on if one ever earns its way back.

## Shape of the room

- **The room is the conversation and the call. That is the whole screen.**
  Header, call row, messages, composer — nothing else, at any width. There is
  no tab strip: tabs are a claim that four things matter equally, and here they
  do not. Anything added above the message list has to earn its row by being
  worth the row of conversation it costs.
- **Everything else is behind the one Menu button** in the conversation, and
  on the screen itself on home — split by what each screen is for, see
  **Home**: who's here, Prompts,
  Board, the table, dad night, sign out. Each opens as a `Sheet` — a native
  `<dialog>`, so the focus trap, Escape, the inert background and the backdrop
  come from the platform. Sheets mount on open, so each reads fresh data.
- The Menu carries a mark when something is waiting for **you** — a question
  you have not answered, a week you have not filled in — and the menu itself
  says which, in words ("a question for you", "your week to fill in") rather
  than a dot: a mark says "something", and something is what a man ignores. A mark for something somebody else did would be noise, and a
  number invites you to drive it to zero. `/api/todo` is what the marks read,
  and it is deliberately about the caller and nobody else.
- **The conversation's header is one row that never wraps** (2026-09-22):
  back, the faces of who is here, the count, the night as `nightShort` ("Thu
  21:00", a countdown inside 24 hours, "the table's open"), the call and the
  menu. The night used to read "dad night Thursdays at 21:00" and folded onto
  two lines under the count on every phone. An icon and an sr-only "Dad night"
  say what it is. **The faces sit OUTSIDE the `connection` button**: initials
  are text, and inside the button they would become part of the "2 here" every
  spec asserts on.
- **The table stays mounted whether or not it is on screen, once it has been
  opened** — unmounting the iframe restarts a game — and `data-table="open"`
  on `main.room` is what shows
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
- **The day-before nudge can be answered from the lock screen** (2026-09-16).
  `dadNightReminder()` puts two actions on the payload, `rsvp-in` and
  `rsvp-out` (`RSVP_ACTIONS`, pinned by a test because `sw.js` matches the
  strings by hand), and the worker answers them with a `PUT /api/rsvp` under
  the app's own cookie, without opening a window. Anything that goes wrong —
  the cookie gone, the network, no night — opens the app instead, where the
  question is still on the card. Android shows the buttons; iOS does not and
  a tap opens the app, which is the fallback everywhere. The worker shows
  only the two actions it knows: an action is a button that runs code in
  there, and the payload does not get to name one.

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

- **A line's text runs straight into the clock beside it.** `hasText` is a
  substring of the whole row, so a line ending in a digit is completed by the
  time: "a week of this 2" said at 4:22 PM reads as "a week of this 24:22 PM",
  and a match for "a week of this 24" then finds two lines and fails on strict
  mode. It passed every local run and every CI run before four o'clock, which
  is the worst way for a test to be wrong. Numbered lines are zero-padded so
  no line is a prefix of another, and the same care is owed to any needle
  ending in a digit.
- **A fixed `settle()` before an assertion is a race, and a loaded machine
  loses it.** The suite is green run alone and on CI, and drops one or two
  tests in a different file every time when something else is running — a
  browser suite, or another session. Wait for the frame instead: the `until`
  helper polls a predicate and asserts it, counted in TRIES rather than against
  the clock, because `night.test.ts` fakes `Date` and a deadline computed from
  `Date.now()` there never arrives. It lives in `test/helpers.ts` (2026-09-16)
  and every file waits with it now; `settle()` survives only as a drain after
  a socket closes, never before an assertion. Its predicate may read D1,
  because fan-out happens before the archive write and a frame having
  arrived says nothing about the row. Two shapes to keep:
  - **A socket's frames are handled in order, so a negative is proven by a
    sentinel.** "The room said nothing" cannot be waited for, but a frame the
    room WILL answer, sent after the ones it must not, can be — and once it is
    back, the quiet ones have been and gone. `table.test.ts` has `sentinel()`;
    the alarm tests count the open line instead, because a line from the early
    firing would have landed ahead of the real one on the same socket.
  - **`enter()` waits for `hello`** (`arrived()`), so nothing is sent on a
    socket the room has not greeted yet. `tick()` moves the clock a
    millisecond for rows whose order is `created_at`; it spins for ever in a
    file that fakes `Date`, so those files never use it.
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
