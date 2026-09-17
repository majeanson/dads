# dads.marcportal.com — Plan

## What it is

A private, invite-coded clubhouse for a small group of dads who already know each other.
One purpose: show up, talk honestly about being a dad, get better at it — and play Jaffre
at the table while you do.

## Locked decisions

| Question      | Decision                                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Entry         | Invite code / passphrase per group. Name on first entry, remembered per device.                                                                                                                                    |
| Core loop     | Live room (presence + chat) + daily prompt + play-while-you-talk.                                                                                                                                                  |
| Growth engine | Weekly check-in (1–5 + one line) **and** weekly commitments, both group-visible.                                                                                                                                   |
| Co-presence   | Scheduled dad night (recurring slot, countdown, reminders). **Widened 2026-09-17**: still the default, but a night can be set to happen once, and when it does the group picks the next date on a shared calendar. |
| Rooms         | Multi-group from day one, keyed by roomId.                                                                                                                                                                         |
| Stack         | Cloudflare Workers + Durable Objects + D1 + React/Vite.                                                                                                                                                            |
| Storage       | DO = live (presence, chat, ws). D1 = durable (check-ins, commitments, prompts, history).                                                                                                                           |
| Jaffre        | Iframe the deployed jaffre + postMessage bridge. No changes to jaffre internals.                                                                                                                                   |
| Prompts       | Curated JSON starter set + dads can submit into their group's pool.                                                                                                                                                |
| Repo          | `~/Documents/WebApp/dads`, own git repo. Never touches the WebApp parent repo.                                                                                                                                     |
| Docs          | No life-as-code. Plain repo + CLAUDE.md.                                                                                                                                                                           |
| Design        | Card-night clubhouse: dark, felt green + wood, the table is the centrepiece.                                                                                                                                       |
| Design, again | M7 made it plain and library-free. **Reversed 2026-09-10**: Tailwind + Radix + lucide on our own palette — controls that read as controls, icons, and some depth.                                                  |
| v1 scope      | Everything, Jaffre embed included.                                                                                                                                                                                 |

## Architecture

```
dads.marcportal.com  ──▶  Worker (router + static assets)
                            │
                            ├─ /r/:code/ws   ──▶ RoomDO (one per group)
                            │                     presence, chat, live prompt answers,
                            │                     "who's at the table", ws hibernation
                            │
                            └─ /api/*        ──▶ D1
                                                  groups, members, check_ins,
                                                  commitments, prompts, messages(archive)

Browser: React SPA
  ├─ Room shell (left: talk column | right: table column)
  ├─ iframe → jaffre deployed URL ?room=<jaffreRoomCode>&name=<displayName>
  └─ postMessage bridge: seat taken / game started / game over → posts into chat
```

**Why DO + D1 split:** the DO gives ordered, low-latency fan-out for the live half and is
naturally one-per-group; D1 holds everything that must survive a DO eviction and that we'll
eventually want to query across weeks (streaks, follow-through, history).

## Data model (D1)

- `groups` — id, slug, name, invite_code_hash, dad_night (weekday + time + tz), created_at
- `members` — id, group_id, display_name, device_token_hash, joined_at, last_seen
- `messages` — id, group_id, member_id, body, kind(chat|system|prompt_answer), created_at
- `prompts` — id, group_id NULL=global, body, author_member_id, active
- `prompt_days` — group_id, date, prompt_id (deterministic pick, recorded so it never changes)
- `check_ins` — id, group_id, member_id, week (ISO), rating 1–5, note, created_at
- `commitments` — id, group_id, member_id, week, body, outcome(pending|done|missed), reflected_at

## Milestones

**M0 — Skeleton (foundation)**
Repo init, Vite + React + TS, Worker + wrangler.jsonc, D1 migrations runner, vitest +
`@cloudflare/vitest-plugin`, Playwright config. CI-able `npm test` from commit 1.

**M1 — Invite + identity**
`/join` with code → verify against `invite_code_hash` → pick display name → signed cookie
(HMAC, Worker secret) binding member_id + group_id. Rejoin from same device is silent.
Group creation is a seeded script/CLI, not a public flow, in v1.

**M2 — The room, live**
RoomDO with WebSocket hibernation: presence roster, chat, typing, join/leave system lines.
Chat persists to D1 on a debounce. Reconnect + backfill. This is the first thing that feels real.

**M3 — Dad night**
Group's recurring slot stored with tz. Countdown on the room header, "tonight" state,
post-night summary line. Email/notification is out of scope — the countdown + the standing
slot is the mechanism we chose.

**M4 — Prompts**
Curated ~100-prompt JSON seeded into `prompts` as global. Deterministic daily pick per group
(hash of date+group_id over the active pool), pinned via `prompt_days`. Answer inline; answers
render as a distinct message kind. "Add a prompt" form feeds the group's pool.

**M5 — Check-ins & commitments**
Weekly board: each dad's 1–5 + one line, and their commitment for the week with a
done/missed toggle. Group-visible by design. Last week's commitments surface at the top of
the new week asking "how'd it go?".

**M6 — Jaffre at the table**
Right column iframes deployed jaffre with a room code derived from the group. postMessage
bridge (versioned message envelope, origin-checked both ways) reports table events into chat.
Fallback: if the iframe is blocked or jaffre is down, the column degrades to a "Play Jaffre"
button that opens a new tab.

**M7 — Clubhouse design pass**
Tokens (felt green, wood, warm off-white ink), the two-column table/talk layout at desktop,
stacked with a tab switch on phone. Contrast audit. Per your Jaffre pattern: function first,
design iterated as its own pass — this is that pass.

**M8 — Deploy**
Worker + D1 to production, `dads.marcportal.com` DNS + custom domain, secrets, seed the real
group, invite the actual dads.

## Testing posture

- Unit/integration on the Worker + DO with `vitest-plugin` (real DO, real D1 migrations).
- Behavioural Playwright e2e only — join with code, two browsers see each other, message
  arrives, check-in appears for both. No UI-detail assertions during the design phase.
- The postMessage bridge gets a contract test against a stub iframe, so jaffre being down
  never breaks the dads suite.

## Risks

1. **Nobody shows up.** Mitigated only by the scheduled night; the whole product depends on it
   being a real commitment between real friends. Nothing technical fixes this.
2. **Jaffre iframe fights us** — third-party cookie / storage partitioning may break jaffre's
   own identity inside the frame. M6 starts with a 30-minute spike to confirm jaffre loads and
   holds a session in an iframe on a different origin before building the bridge.
3. **Group-visible check-ins are socially heavy.** That's the chosen design; if it chills
   participation the smallest fix is a per-entry "just the number" mode. Not building it now.
4. **Invite code leaks.** Codes are rotatable per group; hashed at rest; rate-limited verify.
