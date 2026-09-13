# Where dads stands

Live at **https://dads.marcportal.com**. Invite code for **The Dads**:
`daddy` — one word, and case and spacing don't matter.

Read [PLAN.md](PLAN.md) for the decisions this was built from, and
[CLAUDE.md](CLAUDE.md) for the rules that hold it together.

## What a dad can do

|                     |                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------- |
| **Get in**          | Follow a link, or type the code, and a name. Remembered on that device forever.           |
| **See at a glance** | The app opens on home: when the night is, who is about, what is waiting, how many lines.  |
| **Talk**            | Live chat with presence, typing, reconnect-and-backfill, day dividers.                    |
| **Find it again**   | Any word he half remembers, searched across the whole archive rather than the backfill.   |
| **Be heard**        | Voice call in the room, camera optional. Full WebRTC mesh.                                |
| **Show something**  | Photos, clips and voice notes inline, ten to a room, shrunk in the browser.               |
| **Look at it**      | A photograph opens full-screen in the app, moves to the next one, and saves to the phone. |
| **Keep it**         | Any dad can take a picture off the shelf so the next upload never reaches it.             |
| **Answer**          | A curated question every day, answered in front of the others.                            |
| **Be counted**      | Weekly 1–5, one honest line, one thing to try, and whether it happened.                   |
| **Play**            | Jaffre framed beside the conversation, name passed through, table events in the chat.     |
| **Turn up**         | A standing dad night: countdown, who's coming, what to get into, a nudge, an .ics.        |

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
npm test              # 303, in workerd against the real migrations
npm run e2e           # 65, against the built stack
npm run audit:contrast  # 26 colour pairs, both themes
npm run deploy        # build, then wrangler deploy
npm run prove         # 27, against dads.marcportal.com itself
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
   The reminder was the other, and it has been driven end to end against
   production — see below.

2. **A human's hands on the newest half.** Search, the photo viewer, keeping a
   picture and home-as-the-opening-screen all shipped together on 2026-09-13.
   Every one has an e2e standing behind it and `npm run prove` is green, but
   `prove` proves the DEPLOYMENT — the domain, the headers, the secrets, the
   bindings — and never opens the viewer. Nobody has yet tapped a photograph
   on a real phone on the live site.

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

## The last review

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
  than refused, because an `error` frame costs the outbox its oldest line.

The pass confirmed clean: the search route's parameterisation and its LIKE
escaping, the keep route's group scoping and its 404-not-403 refusal, the
content-type allowlist, and the seen-mark's derivation.

## The review before that

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
