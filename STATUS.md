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
npm test              # 168, in workerd against the real migrations
npm run e2e           # 20, against the built stack
npm run audit:contrast  # 24 colour pairs, both themes
npm run deploy        # build, then wrangler deploy
```

Migrations are separate and go first: `npm run migrate:remote`.

## What has never been proven

Honest list. Everything else in here has a test standing behind it.

1. **The table on an iPhone.** Safari partitions — and can block — storage in
   a third-party frame, and jaffre's identity is localStorage-only. It may
   simply work; it may show a blank panel. The room now waits twelve seconds
   for the table to say anything and then offers a way out, so the failure is
   at least legible. Verified in Chrome only.
2. **The call between two real people on two real networks.** The mesh is
   tested with Chrome's fake devices, reaches a peer connection, and a camera
   turned on now really does appear on the other dad's screen — that has a
   test. Whether a human can hear a human, across two home routers, is not
   something a headless browser can answer. Without `TURN_KEY_ID` /
   `TURN_KEY_API_TOKEN` it is STUN-only, which carries most home connections
   but not all.
3. **A dad night actually completing.** The open and close lines are tested
   with a faked clock; no real Thursday has passed yet.

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

Driving it turned up a defect on **jaffre's** side. `emitTableEvent` is only
reached from the `roster` message; `welcome` sets the first roster itself, so
the `ready` event never fires at all. Everything else crosses — seats, games,
final scores — but dads waits `SILENCE_MS` for *any* event and then tells
every dad "the table isn't answering in here", under a table that is working
fine. The fix is one line in `jaffre/apps/web/src/net/socket.ts`, and it is
not this repo's to make.

## Notes

- There is a member called `abc` in production from a live test. Signing in
  again on that same device with a real name renames it rather than adding a
  second dad.
- Two words is 16 bits. Against the throttle that is weeks of guessing from
  one address, and the URL is not published anywhere. To rotate:
  `npm run group:create -- --slug the-dads --name "The Dads" --words 4 --remote`
