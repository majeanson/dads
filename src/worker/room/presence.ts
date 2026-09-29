import type { RosterEntry } from '../../shared/protocol';
import { newId } from '../identity';
import type { Room, SocketIdentity } from './room';
import { rescheduleAlarm } from './schedule';

/**
 * A phone hopping between wifi and LTE closes and reopens its socket in a few
 * seconds. Without this, every hop would print "Marc left" / "Marc came in".
 */
const LEAVE_GRACE_MS = 15_000;

export function isPresent(room: Room, memberId: string, except?: WebSocket): boolean {
  return room.ctx.getWebSockets(memberId).some((ws) => ws !== except);
}

/**
 * Who is in the room.
 *
 * `except` is the socket that is on its way out: a closing socket is STILL in
 * getWebSockets() while webSocketClose runs, so without this the roster
 * broadcast announcing that a dad left counted him as present — and nothing
 * else ever corrected it. Everyone went on seeing "2 here" for a dad who had
 * shut his laptop, until some unrelated event happened to rebuild it.
 */
export function roster(room: Room, except?: WebSocket): RosterEntry[] {
  const seen = new Map<string, RosterEntry>();
  for (const ws of room.ctx.getWebSockets()) {
    if (ws === except) continue;
    const who = ws.deserializeAttachment() as SocketIdentity | null;
    if (who && !seen.has(who.memberId)) seen.set(who.memberId, { ...who });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function broadcastRoster(room: Room, except?: WebSocket): void {
  room.broadcast({ t: 'roster', roster: roster(room, except) });
}

export async function scheduleLeave(room: Room, who: SocketIdentity): Promise<void> {
  room.sql.exec(
    'INSERT OR REPLACE INTO leaving (member_id, name, leave_at) VALUES (?, ?, ?)',
    who.memberId,
    who.name,
    Date.now() + LEAVE_GRACE_MS,
  );
  await rescheduleAlarm(room);
}

/** @returns whether a leave was pending — i.e. this is a return, not an arrival. */
export function cancelLeave(room: Room, memberId: string): boolean {
  const pending = room.sql
    .exec('SELECT 1 FROM leaving WHERE member_id = ?', memberId)
    .toArray().length;
  if (pending) room.sql.exec('DELETE FROM leaving WHERE member_id = ?', memberId);
  return pending > 0;
}

/** The leaves whose grace ran out by `now`: each one that did not come back
 * is written down as gone. */
export async function leaveDue(room: Room, now: number): Promise<void> {
  const due = room.sql
    .exec<{ member_id: string; name: string }>(
      'SELECT member_id, name FROM leaving WHERE leave_at <= ?',
      now,
    )
    .toArray();

  for (const row of due) {
    room.sql.exec('DELETE FROM leaving WHERE member_id = ?', row.member_id);
    // Reconnected during the grace window but the row survived a race: the
    // dad is here, so he did not leave.
    if (isPresent(room, row.member_id)) continue;
    await notePresence(room, row.member_id, row.name, 'out');
  }
}

/**
 * Somebody arrived, or gave up waiting for the wifi.
 *
 * Deliberately NOT a message. A line in the conversation for every network
 * hop is the room talking about itself, and in a group of five on phones it
 * is most of what the archive would hold. This goes straight to D1 and
 * nowhere near the tail: the roster already says who is here right now, and
 * the comings and goings are read from behind it, by a dad who wants them.
 */
export async function notePresence(
  room: Room,
  memberId: string | null,
  name: string,
  kind: 'in' | 'out',
): Promise<void> {
  const groupId = room.groupId();
  if (!groupId) return;
  try {
    await room.env.DB.prepare(
      `INSERT INTO presence (id, group_id, member_id, name, kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(newId('pres'), groupId, memberId, name, kind, Date.now())
      .run();
  } catch (err) {
    // The man, or the whole group, is gone from D1 while this object still
    // had his leave armed: prove's teardown sweeps the members it invented,
    // and a test run deletes and remakes its groups. There is nobody left
    // to record, so there is nothing to say about it.
    if (String(err).includes('FOREIGN KEY')) return;
    // Nobody is waiting on this, and nothing downstream depends on it.
    console.error('presence write failed', { groupId, name, kind }, err);
  }
}
