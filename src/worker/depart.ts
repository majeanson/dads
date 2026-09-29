import type { Env } from './env';
import { IDENTITY_HEADERS } from './RoomDO';

/**
 * A dad out of a room, whether he walked or was shown the door.
 *
 * His row is marked, never deleted (migration 0024): what he said, marked and
 * wrote down stays, under his name. What goes is everything that let him in
 * or spoke for him going forward — the device token that rejoins him without
 * the word, his phones' push subscriptions, his answer for a night still to
 * come and his marks on a calendar still open. A night he said yes to last
 * month is a fact; one he said yes to for Thursday is a promise nobody will
 * keep.
 *
 * Then the room hears it, and his open sockets are closed from inside it —
 * the cookie stops working on the next request, but a socket already open
 * never makes another one.
 *
 * @returns false when there was nobody here by that id to depart.
 */
export async function depart(
  env: Env,
  groupId: string,
  memberId: string,
  now = Date.now(),
): Promise<boolean> {
  // The token's hash is NOT NULL and unique per group, so it is overwritten
  // with something no HMAC of any token can ever equal, unique to him.
  const marked = await env.DB.prepare(
    `UPDATE members SET gone_at = ?, device_token_hash = 'gone:' || id
      WHERE id = ? AND group_id = ? AND gone_at IS NULL`,
  )
    .bind(now, memberId, groupId)
    .run();
  if (marked.meta.changes === 0) return false;

  await env.DB.batch([
    env.DB.prepare('DELETE FROM push_subscriptions WHERE member_id = ?').bind(memberId),
    env.DB.prepare(
      'DELETE FROM rsvps WHERE group_id = ? AND member_id = ? AND occurrence > ?',
    ).bind(groupId, memberId, now),
    env.DB.prepare('DELETE FROM night_votes WHERE group_id = ? AND member_id = ?').bind(
      groupId,
      memberId,
    ),
  ]);

  const stub = env.ROOM.get(env.ROOM.idFromName(groupId));
  await stub.fetch('https://room/depart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [IDENTITY_HEADERS.groupId]: groupId },
    body: JSON.stringify({ groupId, memberId }),
  });
  return true;
}
