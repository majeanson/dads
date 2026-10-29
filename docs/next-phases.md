# Next phases — review of 2026-10-28

Written after the overnight solidifying pass (branch `solidify/overnight`).
Nothing here is decided; it is what a read of STATUS.md, the stranger review
and the code turned up, ranked by what it protects.

## Found and fixed in the pass

- `pruneShelf` removed past-cap `media` rows in one unchunked `IN (…)`; blobs
  were already deleted by then, so a cap lowered below the backlog would have
  stranded records for good. Chunked, with a regression test.
- The backup list had fallen behind the schema: `events`, `event_rsvps` and
  `member_devices` were not being backed up. A test now fails when a table is
  in neither list.

## Candidate phases

### 1. Data lifecycle (privacy, the part nobody sees)

- **Delete a room.** The stranger review asked and nothing exists: no route
  deletes a `groups` row, so there is no way to remove a room's pictures of
  children (R2 `faces/`, media) short of wrangler. A creator-only, armed,
  named-confirmation "delete this room" that cascades D1, empties the R2
  prefixes and tells the DO to forget its storage.
- **Export what I said.** A dad's own lines as a file. Small, and it answers
  "what do you keep of me" before anyone asks.
- **Retention.** `presence` (every come and go) and `join_attempts` (one row
  per distinct address, ever) are never pruned. Both are small, both are
  unbounded. A prune on the DO's existing alarm, or opportunistically on write
  as `oops` does, keeps them honest.
- **R2 backup.** `npm run backup` is D1 only. Photographs are capped, but
  faces and kept pictures (100 per room) are not recoverable from it.

### 2. Seeing production

- **An oops digest.** `npm run oops` is pull-only. Weekly summary pushed to the
  creator of the proving room, or just to Marc, using the push channel that
  exists.
- **A "last proven" stamp.** `npm run prove` runs by hand; the date of the last
  green run belongs somewhere visible (STATUS.md or a CI badge on a schedule).

### 3. The things a stranger sees (from the 2026-10-23 review, still open)

- A demo room ("peek inside") with a few invented dads, a picked night and a
  short chat — nothing is shown before the gate today.
- Desktop is a phone layout in a window; the two-column home above 48rem
  exists, the room and sheets are the open question.
- A 3-step checklist in an empty room (send the word · pick your days · say
  hi) — `home-invite` covers the first only.

### 4. The product's own loop

- Quiet hours for push (per device, not before / not after). The only
  notifications that can wake someone are `night_start` and "something's on";
  a quiet-hours setting is the usual reason people switch push off.
- A "running late" follow-up inside the night sheet (not a fourth answer on
  home — home asks one question).
- Event "bringing" items, as the night has (any dad adds, only the author
  removes), in a table of their own.
- A season recap on the profile, derived from D1, absent when the board is off.

### 5. Upkeep

- Minor updates pending: wrangler 4.151 → 4.155, `@cloudflare/vitest-plugin`
  1.4.3 → 1.4.10, lucide-react 1.57 → 1.63, vite 8.3.4 → 8.3.5,
  typescript-eslint 8.71 → 8.72. `npm audit --omit=dev` is clean. TypeScript 7
  still waits on typescript-eslint's peer range.
- `format:check` fails locally on Windows (CRLF working tree) while CI on Linux
  passes; a `.gitattributes` with `* text=auto eol=lf` would make the two
  agree.
- The bundle budget now exists (`npm run audit:bundle`). The shared `cn-*.js`
  chunk is ~100 kB raw; worth a look at what lands in it before the next
  feature adds to it.
