import { isGlasses, type RosterEntry } from '../../shared/protocol';
import { broadcastCallRoster, hangUp } from './call';
import { broadcastRoster, cancelLeave, notePresence } from './presence';
import type { Room, SocketIdentity } from './room';
import { rescheduleAlarm } from './schedule';
import { storedFit } from './storage';

/**
 * Everyone in the group, present or not, with each one's face.
 *
 * The roster is who is CONNECTED; this is who exists. A line said on
 * Tuesday by a man who is not here tonight still wants his face beside it,
 * and keeping the version here rather than on the message means a face set
 * this evening reaches every line he ever wrote.
 *
 * Five rows, once per connection. Empty on the failure path rather than
 * fatal: faces missing is a room that falls back to colours, and that is
 * not worth refusing a dad the door.
 */
export async function membersOfGroup(room: Room): Promise<RosterEntry[]> {
  const groupId = room.groupId();
  if (groupId === undefined) return [];
  try {
    const { results } = await room.env.DB.prepare(
      'SELECT id, display_name, avatar_at, glasses, glasses_fit, gone_at FROM members WHERE group_id = ?',
    )
      .bind(groupId)
      .all<{
        id: string;
        display_name: string;
        avatar_at: number | null;
        glasses: string | null;
        glasses_fit: string | null;
        gone_at: number | null;
      }>();
    return results.map((r) => {
      const fit = storedFit(r.glasses_fit);
      return {
        memberId: r.id,
        name: r.display_name,
        face: r.avatar_at ?? undefined,
        ...(isGlasses(r.glasses) ? { glasses: r.glasses } : {}),
        ...(fit ? { fit } : {}),
        ...(r.gone_at !== null ? { gone: true } : {}),
      };
    });
  } catch (err) {
    console.error('members failed', err);
    return [];
  }
}

/**
 * A dad changed his name or his face.
 *
 * His own open sockets are carrying the old one, and the roster is built
 * from those attachments — so without this the other four would go on
 * seeing the old name until he happened to reconnect. Only the Worker can
 * reach this, and it has already written the change to D1.
 */
export async function restamp(
  room: Room,
  memberId: string,
  name: string,
  face: number | null,
): Promise<void> {
  for (const ws of room.ctx.getWebSockets(memberId)) {
    const who = ws.deserializeAttachment() as SocketIdentity | null;
    if (who !== null) {
      ws.serializeAttachment({
        ...who,
        name,
        face: face ?? undefined,
      } satisfies SocketIdentity);
    }
  }
  broadcastRoster(room);
  // And who he is, which reaches his old lines as well as the roster —
  // a face set tonight belongs beside what he said on Tuesday. The pair
  // he wears is read here rather than carried in: a change of name or
  // face does not know it, and a frame without it would take his glasses
  // off every screen. Where they sit on his photo, the same.
  const worn = await room.env.DB.prepare('SELECT glasses, glasses_fit FROM members WHERE id = ?')
    .bind(memberId)
    .first<{ glasses: string | null; glasses_fit: string | null }>()
    .catch(() => null);
  const fit = storedFit(worn?.glasses_fit);
  room.broadcast({
    t: 'member',
    member: {
      memberId,
      name,
      face: face ?? undefined,
      ...(isGlasses(worn?.glasses) ? { glasses: worn.glasses } : {}),
      ...(fit ? { fit } : {}),
    },
  });
}

/**
 * A dad has left the room, or been taken out of it; D1 already says so.
 *
 * His open sockets are told and closed from in here, because the cookie
 * stops working on the next REQUEST and a socket that is already open never
 * makes another one. Their attachments are cleared first, so the close that
 * follows is not a dad dropping off the wifi: no grace, no second "out".
 * Then everybody else hears it — the roster without him, the call without
 * him, and `departed` for the lists of the room's men.
 */
export async function departed(room: Room, memberId: string): Promise<void> {
  let was: SocketIdentity | null = null;
  let onCall = false;
  for (const ws of room.ctx.getWebSockets(memberId)) {
    const who = ws.deserializeAttachment() as SocketIdentity | null;
    if (who !== null) {
      was = who;
      onCall ||= who.inCall === true;
    }
    room.sendTo(ws, { t: 'removed' });
    ws.serializeAttachment(null);
    try {
      ws.close(4001, 'gone');
    } catch {
      // Already closing.
    }
  }
  if (cancelLeave(room, memberId)) await rescheduleAlarm(room);
  if (was !== null) await notePresence(room, memberId, was.name, 'out');

  broadcastRoster(room);
  if (onCall && was !== null) {
    broadcastCallRoster(room);
    hangUp(room, was);
  }
  room.broadcast({ t: 'departed', memberId });
}
