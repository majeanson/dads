import { notifyGroupExcept, type PushPayload } from '../push';
import type { Room } from './room';

/**
 * Something is happening right now that a dad could walk into: somebody
 * picked up the call, or sat down at the table.
 *
 * Only the FIRST one says anything — a call with nobody on it gaining a dad,
 * a dad sitting down — and then the room is quiet about that kind of thing
 * for half an hour. A call that drops and comes back, or an evening of
 * hands with people getting up and sitting down, is one invitation, not ten.
 *
 * Told to the phones that said yes to the night's reminders (2026-10-01):
 * the same subscription, because "the others are on" is the same kind of
 * news as "the table's open". Never in the room: the room writes no lines.
 */
const LIVE_EVERY_MS = 30 * 60_000;

export type LiveKind = 'call' | 'table';

/**
 * Claimed in the object's own storage, before the first await: every framed
 * dad relays the same `seated`, and an eviction between two of them must not
 * forget that the first already went out.
 */
function claim(room: Room, kind: LiveKind, now: number): boolean {
  const key = `live_${kind}`;
  const last = Number(
    room.sql.exec<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, key).toArray()[0]
      ?.value ?? 0,
  );
  if (now - last < LIVE_EVERY_MS) return false;
  room.sql.exec(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, key, String(now));
  return true;
}

export async function tellTheOthers(
  room: Room,
  kind: LiveKind,
  except: string[],
  payload: PushPayload,
): Promise<void> {
  const groupId = room.groupId();
  if (groupId === undefined || !claim(room, kind, Date.now())) return;
  await notifyGroupExcept(room.env, groupId, except, payload);
}
