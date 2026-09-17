# Where dads stands

Live at **https://dads.marcportal.com**. Invite code for **The Dads**:
`daddy` — one word, and case and spacing don't matter.

Read [PLAN.md](PLAN.md) for the decisions this was built from, and
[CLAUDE.md](CLAUDE.md) for the rules that hold it together.

## What a dad can do

|                     |                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Get in**          | Follow a link, or type the code, and a name. Remembered on that device forever.                                                      |
| **See at a glance** | The app opens on home, which asks one question: are you coming on Thursday. The door into the talk and the menu's rows sit under it. |
| **Talk**            | Live chat with presence, typing, reconnect-and-backfill, day dividers, marks, replies, edits and a way to take a line back.          |
| **Find it again**   | Any word he half remembers, searched across the whole archive rather than the backfill.                                              |
| **Be heard**        | Voice call in the room, camera optional. Full WebRTC mesh.                                                                           |
| **Show something**  | Photos, clips and voice notes inline, ten to a room, shrunk in the browser.                                                          |
| **Look at it**      | A photograph opens full-screen in the app, moves to the next one, and saves to the phone.                                            |
| **Keep it**         | Any dad can take a picture off the shelf so the next upload never reaches it.                                                        |
| **Answer**          | A curated question every day, answered in front of the others. What was asked before is one row away.                                |
| **Be counted**      | Weekly 1–5, one honest line, one thing to try, and whether it happened. The weeks before are a tab.                                  |
| **Play**            | Jaffre framed beside the conversation, name passed through, table events in the chat.                                                |
| **Turn up**         | A standing dad night: countdown, who's coming, what to get into, a nudge, an .ics.                                                   |

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
npm test              # 352, in workerd against the real migrations
npm run e2e           # 91, against the built stack
npm run audit:contrast  # 26 colour pairs, both themes
npm run deploy        # build, then wrangler deploy
npm run prove         # 28, against dads.marcportal.com itself
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

What has NOT been through a phone yet is the day after that (2026-09-15):
home cut down to the one question, the menu's rows on home itself, the
header split into its two shapes, and every control at 44px with the one
action on a sheet bigger still. Playwright checked it at 390px in both
languages; a thumb in a kitchen has not.

## The last review

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

## The review before that

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

## Notes

- The code is one word, so the only thing behind it is the join throttle: ten
  wrong guesses per IP per ten minutes, each costing a 100k-iteration PBKDF2.
  Real friction for a casual guesser, not much against somebody determined who
  knows the address. The invite links are the better way in. To rotate without
  costing the group its history:
  `npm run group:create -- --slug the-dads --rotate --code "<code>" --remote`
- Every driven check against production joins as a new member, because a fresh
  browser is a fresh dad. Sweeping them up afterwards:
  `delete from members where id not in (select distinct member_id from messages)`
