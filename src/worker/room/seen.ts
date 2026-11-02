import type { Room, SocketIdentity } from './room';

/**
 * Where a dad got to in the conversation, kept on him rather than on his
 * phone (Marc asked, 2026-11-02).
 *
 * Every count of "new" lines is worked out on the phone from this one number,
 * so all the room does is keep it and pass it on: written to his member row,
 * which is the one thing both of his devices share, and relayed to his OTHER
 * open sockets so the phone in his pocket stops saying "12 new" the moment he
 * reads them on the laptop. Nobody else is told. Whether a man has read a
 * line is his business.
 *
 * Only ever forward. A phone back from a drawer with an old mark must not
 * make lines he has read new again on the other one, so the write says so
 * itself (`seen_seq < ?`) and a relay only follows a write that moved it.
 */
export async function noteSeen(
  room: Room,
  ws: WebSocket,
  who: SocketIdentity,
  seq: number,
): Promise<void> {
  // A phone sends its mark at most once a second while he reads. No D1 round
  // trip for a mark no further than one the room has already written since it
  // woke; claimed before the await, so two sockets racing with the same mark
  // make one write. Forgotten on eviction, which costs one write that the
  // WHERE turns into nothing.
  const marks = room.memory.seen;
  if (seq <= (marks.get(who.memberId) ?? 0)) return;
  marks.set(who.memberId, seq);

  const groupId = room.groupId();
  if (groupId === undefined) return;
  const { meta } = await room.env.DB.prepare(
    `UPDATE members SET seen_seq = ?
     WHERE id = ? AND group_id = ? AND gone_at IS NULL
       AND (seen_seq IS NULL OR seen_seq < ?)`,
  )
    .bind(seq, who.memberId, groupId, seq)
    .run();
  if (meta.changes === 0) return;

  for (const other of room.ctx.getWebSockets(who.memberId)) {
    if (other !== ws) room.sendTo(other, { t: 'seen', seq });
  }
}

/**
 * The mark a hello just read from D1 is the furthest the room knows of.
 * Remembered, so a phone that connects and sends what it already had costs
 * nothing.
 */
export function knownSeen(room: Room, memberId: string, seen: number | null): void {
  if (seen === null) return;
  const marks = room.memory.seen;
  if (seen > (marks.get(memberId) ?? 0)) marks.set(memberId, seen);
}
