# Where dads stands

Live at **https://dads.marcportal.com**. A room is opened at the door and its
word is chosen there; nothing here knows it, and nothing here should.

Read [PLAN.md](PLAN.md) for the decisions this was built from, and
[CLAUDE.md](CLAUDE.md) for the rules that hold it together.

## What a dad can do

|                     |                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Get in**          | Follow a link, or type the code, and a name. Remembered on that device forever.                                                      |
| **Open a room**     | Anybody at the door can start one and choose its word. Whoever opens it owns its switches and its word, and can hand it on.          |
| **Be in several**   | One phone, several rooms, and a sheet to move between them without typing a word again.                                              |
| **See at a glance** | The app opens on home, which asks one question: are you coming on Thursday. The door into the talk and the menu's rows sit under it. |
| **Talk**            | Live chat with presence, typing, reconnect-and-backfill, day dividers, marks, replies, edits and a way to take a line back.          |
| **Find it again**   | Any word he half remembers, searched across the whole archive rather than the backfill.                                              |
| **Be heard**        | Voice call in the room, camera optional. Full WebRTC mesh.                                                                           |
| **Show something**  | Photos, clips and voice notes inline, ten to a room, shrunk in the browser.                                                          |
| **Look at it**      | A photograph opens full-screen in the app, moves to the next one, and saves to the phone.                                            |
| **Keep it**         | Any dad can take a picture off the shelf so the next upload never reaches it.                                                        |
| **Answer**          | A curated question every day, answered in front of the others. What was asked before is one row away.                                |
| **Be counted**      | Weekly 1–5, one honest line, one thing to try, and whether it happened. The weeks before are a tab.                                  |
| **Play**            | Jaffre framed beside the conversation, name passed through, the table's state in its own panel head.                                 |
| **Turn up**         | A standing dad night or one arranged evening: countdown, in / maybe / out, what to get into, a nudge, an .ics.                       |
| **Pick a date**     | With no evening to come, a shared month calendar: everyone marks the days they can, anyone locks one in.                             |

The conversation is only what the dads typed. The room used to narrate itself
(RSVPs, check-ins, seats at the table, the night being set, a closing summary);
since 2026-09-17 each of those lives on its own screen, and a `stir` frame tells
open screens to re-read.

## The shape of it

- **Cloudflare Worker** serves the API, the websockets and the built client.
- **One Durable Object per group** owns the live half: presence, chat fan-out,
  typing, the call's signalling, the leave-grace and dad-night alarms.
- **D1** owns everything that must outlive an eviction: members, the message
  archive, prompts, check-ins, commitments, media records.
- **R2** holds the photos, the clips and the voice notes, never publicly — always through the Worker, behind
  the session check, scoped to the caller's own group.

## Checks

```bash
npm run typecheck
npm run lint
npm test              # 379, in workerd against the real migrations
npm run e2e           # 121, against the built stack (111 in Chromium, 10 on the iPhone)
npm run audit:contrast  # 68 colour pairs, both themes
npm run deploy        # build, then wrangler deploy
npm run prove         # 32, against dads.marcportal.com itself, in its own room
npm run backup        # every D1 table into backups/, gitignored
```

Migrations are separate and go first: `npm run migrate:remote`.

## What has never been proven

Honest list. Everything else in here has a test standing behind it.

1. **The call between two real people on two real networks.** The mesh is
   tested with Chrome's fake devices, reaches a peer connection, and a camera
   turned on now really does appear on the other dad's screen — that has a
   test. Whether a human can hear a human, across two home routers, is not
   something a headless browser can answer. A Cloudflare Realtime relay is
   configured in production now (`dads-key`), so a dad behind a strict NAT has
   a way through as well — verified by `/api/ice` returning credentialed
   `turn:` and `turns:` servers alongside the STUN ones.
   That is now the only one. The reminder was one of the others and has been
   driven end to end against production; the newest half was the last, and a
   real phone has now been through it — both below.

## Proven: the reminder, and what it took to see it

A real Chrome, in a persistent profile on a real desktop, subscribed through
the app's own switch, and the night was set three minutes out on production.
The service worker showed `dads — The table's open.` The whole chain holds:
VAPID ES256, RFC 8291 aes128gcm, FCM accepting the POST, the push queued while
the browser was shut and delivered when it came back, the worker waking and
calling showNotification.

**It did not work on the first try, and that is the point of having done it.**
Chrome handed back `https://jmt17.google.com/fcm/send/…` — not the
`fcm.googleapis.com` its own documentation names — and the endpoint allowlist
refused it with a 400. Nobody would ever have seen that: the switch simply
would not have stayed on, for the browser most of the dads use. Google's hosts
are matched by suffix now and narrowed by path (`/fcm/send/`) instead, and the
real endpoint is in the test.

Three things had to be true before any of it could be observed, none of them
obvious: headless Chrome reports notifications as `denied` outright; a normal
Playwright context is incognito, and Chrome has no Push API there; and a
notification can be seen from the page through
`registration.getNotifications()`, which is what turns "it was sent" into
"it was shown".

What is still unproven is a human's eyes on a phone's lock screen, which is
now a cosmetic question rather than a technical one.

## Proven on a real phone

The newest half — search, the photo viewer, keeping a picture, and home as the
screen the app opens on — has been through a real phone on the live site
(2026-09-14), the day after it shipped. A photograph opened, a picture was
kept, a word from an old line was found again, and home said the right things
on a cold open. All of it worked.

That matters because none of it is what `npm run prove` proves. `prove` is
about the DEPLOYMENT: the domain, the assets binding answering before the
Worker, the headers that only exist because `public/_headers` shipped, and
secrets that are only set in production. It never opens the viewer, and a
headless browser has nothing to say about whether a photograph of somebody's
child looks right on a phone in a kitchen.

By 2026-09-22 everything since then has been played with on a phone as well:
home cut down to one question, the rooms, the calendar. Nothing was broken.
What came back was about the look: a few screens still need decluttering, and
some need to be more interesting to look at.

On 2026-09-25 every screen was walked at 390×667 in English, French and dark
by a headless phone and read off contact sheets — not a hand on a real one,
but the pass that found the night sheet's wrapped answers and the creator's
Settings running off the bottom. What a real thumb still owes: the splash and
the glasses on a real screen, and the voice note's length on an iPhone.

## The last review

A hostile read over the week that brought the glasses and the fit, the change
log, the crown, the splash and the iPhone project (2026-09-25; 35 commits,
about 5,900 lines), then every screen at 390×667 in English, French and dark.
Six defects were fixed the same day, and two things the walk turned up; every
one is pinned by a test that fails without the fix.

- **A resume past a hundred pruned pictures locked the phone out.** The two
  `IN (…)` queries the resume path builds were the only ones in the object
  not chunked at 80, and the local D1 refuses more than a hundred bound
  parameters just as the real one does: the hello threw, the client asked
  the same question again with the same `rev`, and a home-screen app never
  reloads. Every such query goes through one `chunks()` now.
- **A lost echo cost two self-inflicted reconnects.** The room dropped a
  re-sent cid in silence, so a phone whose socket died between the room
  taking the line and the echo reaching it held the line for ever — closed a
  perfectly good socket after eight seconds to try again, was ignored again,
  and closed again. The repeat is answered with the line it already became,
  and a line since taken back with a refusal that names it.
- **A line taken back from under an open menu swallowed every tap after it.**
  The "a menu is open" flag lived at module scope and was only ever reset by
  a close Radix reported; an unmount reports nothing. From then on every tap
  on every line was treated as the lift at the end of a long press. The flag
  comes down when an open menu unmounts.
- **A voice note recorded in Chrome had no length and no seeking** until it
  had played once, because a MediaRecorder webm carries no duration. The
  player now seeks past the end once on load, which makes the browser find
  out, and puts it back to nought.
- **Home overflowed the small phone with a full table and the night days
  away.** "Full table" shared the countdown's line, which does not exist
  past three days out; the row it then took was the ten pixels home had to
  spare. It takes the place of "In" before the names now, which costs a
  word rather than a line.
- **The fitter's footer hung fifty pixels past its popover in French**, and
  English fit by six. The footer wraps and the reset button says less.
- **The night sheet's three answers wrapped two-and-one** in both languages,
  under a card that had shown the same question as one row. It is home's
  control now (`Answers.tsx`).
- **The creator's Settings did not fit the phone.** The word and the handover
  came with a paragraph each, and the fit suite signs in as a joined dad who
  never sees them — and his sheet fills the phone to the pixel, so nothing
  of its own fits. Both are behind a control on the heading's own row now,
  and the suite opens a room of its own to measure the creator's sheet.

The read also confirmed clean: group scoping and authority on every route
added this week, SQL parameterisation, the three migrations against a live
D1, the one-alarm rule, the `rev` arithmetic and the `fresh` replace, the
origin check on every bridge event, reduced motion, the palette blocks and
the audit, and the dictionary. jaffre `c48042b` is deployed and its
`winners` shape matches what the room parses.

**The smaller ones, fixed the same afternoon**: the picker popover is a named
dialog, the fitter takes the focus when it opens, and a pair saving no longer
drops it; a pull on home that the phone cancels no longer leaves the mark
hanging; a default mark only gives way to one he uses more, and the row no
longer reshuffles under his thumb inside an open menu; a table name cut on a
space is trimmed, so that dad is nudged and crowned; a keyboard click inside
a line is never taken for the lift of a long press; the answer to an edit he
walked away from no longer clears or scolds the next one, and a live `edited`
settles only on his own words; a fit is refused over a face with no photo;
a mark by a dad not here tonight carries his name; the table's failure note
clears when a new table arrives; and the face preview's object URL is freed
when Settings closes. Four carry a test: the favourites, the table name and
the fit (unit), and the edit he walked away from (e2e). The rest are small
enough that the fix is the whole of it.

**Still open**: the crown's dedupe races the four relays it exists for
(benign — the same crown twice), and "go in twice inside the film" is pinned
only probabilistically.

## The review before that

A hostile read over the fortnight that brought replies, edits, marks and the
emoji picker found three defects, and running `prove` against the live site
straight afterwards found two more. All five are fixed and every one is
pinned by a test.

- **An edit was cleared from the composer the moment `ws.send` did not
  throw** — the one thing this app has always said delivery is not. A man in
  a dead spot pressed Send, his new words vanished, and the line went on
  saying what it always said. An edit waits for its own line to come back
  changed now, keeps his words when it does not, and says so.
- **An `error` frame dropped the oldest line in the outbox**, which was a
  guess dressed as a rule: everything a dad can send is refused with the same
  handful of codes, so a refused edit threw away a perfectly good chat line.
  A refusal carries the sender's `cid` back and the outbox drops the line it
  names.
- **A quote outlived the retraction of the line it quoted** — the one place
  "a line can be taken back, and then it is gone" was not true, with his
  words back on every screen under somebody's answer. It goes now, in the
  tail and the archive; a quote still outlives an EDIT, which is what a
  snapshot is for.
- **The questions sheet was 26px wider than a 360px phone in French**, with
  the Add button off the right-hand edge. A menu row never wraps, and an
  implicit `auto` grid column takes the width of its widest child.
- **And so was the menu itself**, for a dad who had just arrived — because he
  is the one with both marks on his rows, which is the widest a row ever
  gets. Both grids are `minmax(0, 1fr)` now and every label gives way before
  the layout does.

The last two are the more interesting pair. Nothing local could have caught
either: the row that overflowed carries a COUNT, and a group that has never
been asked anything has no count on it — every local fixture was such a
group, so the row fit until the day the real one did not. The e2e fixture has
three days of questions behind it now, and the suite measures both sheets at
360 in French.

The pass confirmed clean: the reply snapshot's resolution and its bounds, the
edit and retract authority checks against the archive and the tail, the mark
allowlist before it reaches a column, the group scoping on every write, and
the double tap's exclusion of links, photographs and controls.

## Two before that

A hostile read over the fortnight that brought search, the viewer, keeping a
photograph, home and the `Room.tsx` decomposition found five defects. Four are
fixed, three of them pinned by a test:

- **The media listing was bounded by one shelf**, which was right until there
  were two: thirty voice notes would have hidden every photograph in the room
  from anything that asked.
- **The composer's picker died with the socket**, with nothing on the label to
  say so — a dad on a wifi-to-LTE hop tapping a `+` that did nothing.
- **A photograph on a search result was a button that went nowhere**, which is
  still a button to a thumb and to a screen reader.
- **`highlight` sliced the original at offsets found in the lowercased copy**,
  and lowercasing is not always length-preserving.
- **The same picture could be hung on two lines**, and retracting either
  deleted the blob out from under the other. No client could reach it; the
  room refuses it now, and a re-sent line is still dropped silently rather
  than refused, because an `error` frame costs the outbox the line it names.

The pass confirmed clean: the search route's parameterisation and its LIKE
escaping, the keep route's group scoping and its 404-not-403 refusal, the
content-type allowlist, and the seen-mark's derivation.

## And the one before that

A fresh adversarial review found eleven defects; all eleven are fixed and
four now have tests pinning them. Three mattered:

- **Stored XSS on our own origin** — an uploaded `text/html` or
  `image/svg+xml` was served back with the type the uploader declared. Types
  are an allowlist now, everything else downloads instead of rendering.
- **The backfill's `IN (…)` was unbounded** — past D1's parameter ceiling it
  would have thrown while building the hello frame, locking that dad into a
  reconnect loop.
- **The camera toggle reached nobody** — the mesh only let one side offer, so
  adding a track never renegotiated. It uses perfect negotiation now.

The review confirmed clean: group isolation, SQL parameterisation, the React
XSS surface, the WebRTC relay's spoofing resistance, the postMessage bridge,
the identity cookie, and the week and DST arithmetic.

## Proven since, and what it turned up

The jaffre bridge has now crossed between the two live apps: a second player
sat down at **the-dads** table on jaffre.marcportal.com and
`Secondchair sat down at the table.` appeared in the production room. That was
unproven #3.

Driving it turned up a defect on **jaffre's** side, since fixed and deployed.
`emitTableEvent`'s `ready` was reached only from the `roster` message, and
`welcome` sets the first roster itself — so `ready` had never fired in
production. Everything else crossed — seats, games, final scores — but dads
waits `SILENCE_MS` for _any_ event and was therefore telling every dad "the
table isn't answering in here", under a table that was working perfectly.
`welcome` now announces through the same path, pinned by an e2e in jaffre with
a stand-in embedder on its own origin. Verified live: the frame speaks, and the
warning is gone.

## Proven on a real clock

The jaffre table works inside the app on an iPhone — Safari gave the framed
game its storage, so the partitioning case the fallback exists for did not
happen there. The fallback stays: it costs nothing, and the next iOS release
is not ours to predict.

Dad night runs itself, both ends, on a real clock. Set five minutes out on
production, the room posted "Dad night. The table's open." at 14:03 with
nobody watching; set again so that a window closed five minutes later, it
posted "Dad night done — one dad turned up, 3 lines."

Changing the night cancels whatever was armed for the old one, which is right
and is worth knowing: resetting the slot two minutes after it opened is what
made the first summary never arrive.

(Both of those were room lines, and the room writes no lines now. The alarms
still fire on the same clock; the open reaches the phones that asked, and the
summary is gone.)

## Production, 2026-09-25

Two rooms. **Throwback daddies** (`throwback-daddies`), opened at the door on
2026-09-17, is the dads'. **The Prove Room** (`prove-room`) was made from the
laptop on 2026-09-25 for `npm run prove`, which used to write into the dads'
room and now never touches it; its word is in this machine's `.dev.vars`. The
room this document calls `the-dads` above no longer exists — production was
wiped and rebuilt before the repo went public. No room has been opened by
anybody else.

## Notes

- The code is one word, so the only thing behind it is the join throttle: ten
  wrong guesses per IP per ten minutes, each costing a 100k-iteration PBKDF2.
  Real friction for a casual guesser, not much against somebody determined who
  knows the address. The invite links are the better way in. The room's
  creator changes the word from Settings, which also kills the invite links
  that were out. From a laptop, without costing the group its history:
  `npm run group:create -- --slug <slug> --rotate --code "<code>" --remote`
- Every driven check against production joins as a new member, because a fresh
  browser is a fresh dad. `prove`'s teardown sweeps its own by name; anything
  driven by hand is swept with
  `delete from members where id not in (select distinct member_id from messages)`
