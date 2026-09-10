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
npm test              # 164, in workerd against the real migrations
npm run e2e           # 19, against the built stack
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
   tested with Chrome's fake devices and reaches a peer connection. Whether a
   human can hear a human, across two home routers, is not something a
   headless browser can answer. Without `TURN_KEY_ID` / `TURN_KEY_API_TOKEN`
   it is STUN-only, which carries most home connections but not all.
3. **The jaffre bridge against the live pair.** Both halves are deployed and
   both are unit-tested, but "Marc sat down at the table" has never crossed
   between the two production apps.
4. **A dad night actually completing.** The open and close lines are tested
   with a faked clock; no real Thursday has passed yet.

## Notes

- There is a member called `abc` in production from a live test. Signing in
  again on that same device with a real name renames it rather than adding a
  second dad.
- Two words is 16 bits. Against the throttle that is weeks of guessing from
  one address, and the URL is not published anywhere. To rotate:
  `npm run group:create -- --slug the-dads --name "The Dads" --words 4 --remote`
