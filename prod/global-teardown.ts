import { readFileSync } from 'node:fs';
import { run } from '../scripts/run';
import { MARK } from './names';

/**
 * The ops secret, from the environment or from .dev.vars.
 *
 * .dev.vars is gitignored and is already where this machine keeps the things
 * production knows and the repo must not.
 */
function opsSecret(): string | null {
  if (process.env.DADS_OPS_SECRET) return process.env.DADS_OPS_SECRET;
  try {
    const line = readFileSync('.dev.vars', 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith('OPS_SECRET='));
    return line ? line.slice('OPS_SECRET='.length).trim() : null;
  } catch {
    return null;
  }
}

/**
 * Deleting from D1 is only half of it.
 *
 * The room serves its backfill from the Durable Object's own capped tail, so a
 * line taken out of the archive goes on appearing for everybody until five
 * hundred more have been said — which for five friends is never. This is the
 * half that reaches the object.
 */
async function forgetInTheRoom(base: string, secret: string): Promise<void> {
  const res = await fetch(`${base}/api/ops/forget`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dads-Ops': secret },
    body: JSON.stringify({ like: `%${MARK}%` }),
  });
  if (!res.ok) {
    console.error(`prod teardown: /api/ops/forget answered ${res.status}`);
    return;
  }
  const { archive, tail } = (await res.json()) as { archive: number; tail: number };
  console.log(`prod: forgot ${archive} archived and ${tail} remembered lines`);
}

/**
 * Puts the room back.
 *
 * This suite joins as real members and says real things, and none of that can
 * be undone through the app — a room has no delete, on purpose. So the sweep
 * goes through D1 directly, and it is keyed on the name prefix rather than on
 * "anything recent": the last thing this should ever do is take a line one of
 * the actual dads wrote.
 *
 * Order matters. The messages, the answers, the marks and the agenda items
 * reference the members, so the members go last; the R2 blobs behind any
 * uploads are left to the media cap, which is the thing that owns them.
 *
 * And the ROOMS this suite opens, since rooms can be opened through the app.
 * A test that makes one and leaves it behind is a permanent row in the real
 * database with a word nobody knows, growing by one every run — and it takes
 * a join word out of circulation for ever, because words are unique across
 * every room. They are named with the same marker as everything else.
 */
export default async function globalTeardown(): Promise<void> {
  // The room's own memory first, while the members are still there to be
  // matched: the lines this reaches say their names.
  const secret = opsSecret();
  if (secret === null) {
    console.error('prod teardown: no OPS_SECRET, so the room will keep the lines this run said');
  } else {
    await forgetInTheRoom(process.env.PROD_URL ?? 'https://dads.marcportal.com', secret);
  }

  const like = `'${MARK}%'`;
  const mine = `SELECT id FROM members WHERE display_name LIKE ${like}`;
  /** Rooms this suite opened. Named with the marker, like everything else it
   * invents, so the sweep can find them and the dads' own room cannot match. */
  const rooms = `SELECT id FROM groups WHERE name LIKE ${like}`;

  const statements = [
    `DELETE FROM night_items WHERE member_id IN (${mine})`,
    `DELETE FROM rsvps WHERE member_id IN (${mine})`,
    `DELETE FROM check_ins WHERE member_id IN (${mine})`,
    `DELETE FROM commitments WHERE member_id IN (${mine})`,
    `DELETE FROM push_subscriptions WHERE member_id IN (${mine})`,
    `DELETE FROM presence WHERE member_id IN (${mine})`,
    // A mark this suite put on one of the real dads' lines. The foreign keys
    // would cascade it when the member goes, but a sweep that leans on a
    // PRAGMA being on is a sweep that reports itself clean while something
    // stays in the room.
    `DELETE FROM reactions WHERE member_id IN (${mine})`,
    `DELETE FROM messages WHERE member_id IN (${mine})`,
    // The lines the ROOM wrote about them — "… is in.", "…, for dad night: …"
    // — carry no member id, so the sweep above cannot see them. They are the
    // only things in the archive that mention the marker, which is what makes
    // this safe to key on a body match.
    `DELETE FROM messages WHERE member_id IS NULL AND body LIKE '%${MARK}%'`,
    `DELETE FROM members WHERE display_name LIKE ${like}`,
    // Everything in a room the suite opened, then the room. Its members are
    // gone by now — they carry the marker too — so this is the room itself
    // and whatever hangs off it that nothing above reached.
    `DELETE FROM night_votes WHERE group_id IN (${rooms})`,
    `DELETE FROM rsvps WHERE group_id IN (${rooms})`,
    `DELETE FROM night_items WHERE group_id IN (${rooms})`,
    `DELETE FROM check_ins WHERE group_id IN (${rooms})`,
    `DELETE FROM commitments WHERE group_id IN (${rooms})`,
    `DELETE FROM presence WHERE group_id IN (${rooms})`,
    `DELETE FROM reactions WHERE group_id IN (${rooms})`,
    `DELETE FROM invites WHERE group_id IN (${rooms})`,
    `DELETE FROM media WHERE group_id IN (${rooms})`,
    `DELETE FROM messages WHERE group_id IN (${rooms})`,
    `DELETE FROM prompt_days WHERE group_id IN (${rooms})`,
    `DELETE FROM prompts WHERE group_id IN (${rooms})`,
    `DELETE FROM members WHERE group_id IN (${rooms})`,
    `DELETE FROM groups WHERE name LIKE ${like}`,
  ];

  for (const sql of statements) {
    try {
      run('npx', ['wrangler', 'd1', 'execute', 'dads', '--remote', '-y', '--command', sql]);
    } catch (err) {
      // A failed sweep is worth shouting about — it means somebody has to go
      // and look — but it must not turn a green suite red.
      console.error('prod teardown: could not run', sql, err);
    }
  }
  console.log(`\nprod: swept up every member named ${MARK}…`);
}
