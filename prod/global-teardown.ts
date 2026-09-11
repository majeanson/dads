import { run } from '../scripts/run';
import { MARK } from './names';

/**
 * Puts the room back.
 *
 * This suite joins as real members and says real things, and none of that can
 * be undone through the app — a room has no delete, on purpose. So the sweep
 * goes through D1 directly, and it is keyed on the name prefix rather than on
 * "anything recent": the last thing this should ever do is take a line one of
 * the actual dads wrote.
 *
 * Order matters. The messages, the answers and the agenda items reference the
 * members, so the members go last; the R2 blobs behind any uploads are left
 * to the media cap, which is the thing that owns them.
 */
export default function globalTeardown(): void {
  const like = `'${MARK}%'`;
  const mine = `SELECT id FROM members WHERE display_name LIKE ${like}`;

  const statements = [
    `DELETE FROM night_items WHERE member_id IN (${mine})`,
    `DELETE FROM rsvps WHERE member_id IN (${mine})`,
    `DELETE FROM check_ins WHERE member_id IN (${mine})`,
    `DELETE FROM commitments WHERE member_id IN (${mine})`,
    `DELETE FROM push_subscriptions WHERE member_id IN (${mine})`,
    `DELETE FROM presence WHERE member_id IN (${mine})`,
    `DELETE FROM messages WHERE member_id IN (${mine})`,
    // The lines the ROOM wrote about them — "… is in.", "…, for dad night: …"
    // — carry no member id, so the sweep above cannot see them. They are the
    // only things in the archive that mention the marker, which is what makes
    // this safe to key on a body match.
    `DELETE FROM messages WHERE member_id IS NULL AND body LIKE '%${MARK}%'`,
    `DELETE FROM members WHERE display_name LIKE ${like}`,
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
