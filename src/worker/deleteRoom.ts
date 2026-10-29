import type { Env } from './env';
import { IDENTITY_HEADERS } from './RoomDO';

/**
 * A room ended, with everything it held.
 *
 * Pictures of children are the reason this exists: a room's photographs and
 * its dads' faces are R2 objects, and no row anywhere can delete those but
 * this. The order is the point. The blobs go FIRST, because they are the
 * thing nothing else would ever find again; if that fails half way the room
 * is still whole and the creator can simply try again. Then D1 — every table
 * of the group's cascades from `groups`, and the session lookup stops
 * finding any of them in the same moment. Then the room's own storage, which
 * has no row to cascade from and would otherwise sit there holding the last
 * five hundred lines.
 *
 * `oops` is the one table of the group's that does not cascade (a fault
 * report outlives the thing it was about), so it is cleared by hand.
 */
export async function deleteRoom(env: Env, groupId: string): Promise<void> {
  await emptyPrefix(env.MEDIA, `${groupId}/`);
  await emptyPrefix(env.MEDIA, `faces/${groupId}/`);

  await env.DB.batch([
    env.DB.prepare('DELETE FROM oops WHERE group_id = ?').bind(groupId),
    env.DB.prepare('DELETE FROM groups WHERE id = ?').bind(groupId),
  ]);

  const stub = env.ROOM.get(env.ROOM.idFromName(groupId));
  await stub.fetch('https://room/dissolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [IDENTITY_HEADERS.groupId]: groupId },
    body: '{}',
  });
}

/** Every object under a prefix, a thousand at a time (R2's page and batch). */
async function emptyPrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    if (page.objects.length > 0) await bucket.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
}
