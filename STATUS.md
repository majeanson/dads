# Where dads stands

Live at **https://dads.marcportal.com**. Invite code for **The Dads**:
`buckle daisy` (two words, case and spacing don't matter).

Read [PLAN.md](PLAN.md) for the decisions this was built from, and
[CLAUDE.md](CLAUDE.md) for the rules that hold it together.

## What a dad can do

|                    |                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------- |
| **Get in**         | Type the code and a name. Remembered on that device forever.                          |
| **Talk**           | Live chat with presence, typing, reconnect-and-backfill, day dividers.                |
| **Be heard**       | Voice call in the room, camera optional. Full WebRTC mesh.                            |
| **Show something** | Photos and files inline, ten to a room, shrunk in the browser.                        |
| **Answer**         | A curated question every day, answered in front of the others.                        |
| **Be counted**     | Weekly 1–5, one honest line, one thing to try, and whether it happened.               |
| **Play**           | Jaffre framed beside the conversation, name passed through, table events in the chat. |
| **Turn up**        | A standing dad night with a countdown, announced and summarised in the room.          |

## The shape of it

- **Cloudflare Worker** serves the API, the websockets and the built client.
- **One Durable Object per group** owns the live half: presence, chat fan-out,
  typing, the call's signalling, the leave-grace and dad-night alarms.
- **D1** owns everything that must outlive an eviction: members, the message
  archive, prompts, check-ins, commitments, media records.
- **R2** holds the photos, never publicly — always through the Worker, behind
  the session check, scoped to the caller's own group.

## Checks

```bash
npm run typecheck
npm run lint
npm test              # 183, in workerd against the real migrations
npm run e2e           # 32, against the built stack
npm run audit:contrast  # 24 colour pairs, both themes
npm run deploy        # build, then wrangler deploy
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
2. **A reminder actually arriving on a phone.** The endpoint mints a key, the
   subscribe and unsubscribe round trip is tested, and the send is jaffre's
   proven code — but no notification has yet gone from this Worker to a real
   lock screen. To try it: add dads to the home screen, open the menu, press
   "Tell me when the table opens", then set dad night to a few minutes from
   now. Headless Chrome cannot answer this: it reports notifications as
   blocked, which is the path it exercises instead.

## The last review

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

- There is a member called `abc` in production from a live test. Signing in
  again on that same device with a real name renames it rather than adding a
  second dad.
- Two words is 16 bits. Against the throttle that is weeks of guessing from
  one address, and the URL is not published anywhere. To rotate:
  `npm run group:create -- --slug the-dads --name "The Dads" --words 4 --remote`
