import { tableName } from '../../shared/jaffre';
import type { Champions, ClientFrame } from '../../shared/protocol';
import { notifyMember } from '../push';
import type { Room } from './room';

/** A hand takes a minute or two; a nudge per hand is a nag. */
const TURN_NUDGE_EVERY_MS = 3 * 60_000;

/** Every framed dad relays the same game-over; one crown per game. */
const CROWN_REPEAT_MS = 60_000;

/**
 * A relayed table event. It still comes, and still does exactly one thing:
 * his turn has sat for twenty seconds, so his phone hears about it. What the
 * table is doing is on the table, which is on the screen beside this.
 */
export async function onTable(
  room: Room,
  frame: Extract<ClientFrame, { t: 'table' }>,
): Promise<void> {
  if (frame.event.t === 'turn') await nudgeTurn(room, frame.event.name);
  // And one more (2026-09-24): a game that ends names who won it, and
  // they wear gold glasses until the next one does.
  if (frame.event.t === 'game-over' && frame.event.winners !== undefined) {
    await crown(room, frame.event.winners);
  }
}

/** Who won the last game, from D1; null for a group nobody has won in. */
export async function champions(room: Room): Promise<Champions | null> {
  const groupId = room.groupId();
  if (groupId === undefined) return null;
  const row = await room.env.DB.prepare('SELECT champions FROM groups WHERE id = ?')
    .bind(groupId)
    .first<{ champions: string | null }>()
    .catch(() => null);
  if (!row?.champions) return null;
  try {
    const v = JSON.parse(row.champions) as Partial<Champions>;
    return Array.isArray(v.ids) && typeof v.at === 'number'
      ? { ids: v.ids.filter((id): id is string => typeof id === 'string'), at: v.at }
      : null;
  } catch {
    return null;
  }
}

/**
 * Crown whoever won the game that just ended.
 *
 * Every framed dad relays the same game-over a few hundred milliseconds
 * apart, so a crown for the same men inside a minute is the same game and
 * is dropped — claimed in memory first (`crownClaim`), then checked against
 * the stored crown for an object that was evicted in between. Names are
 * joined the way a turn nudge joins them — as the table knows them, twenty
 * characters — and a winner who is not a dad here (a guest at the table)
 * crowns nobody. A game no human won still ends the last crown: "until the
 * next game ends" is the whole rule.
 *
 * Trusts the frame like the turn nudge does: any dad's socket can send one,
 * and a man who crowns himself by hand has earned it, among five friends.
 */
async function crown(room: Room, winners: string[]): Promise<void> {
  const groupId = room.groupId();
  if (groupId === undefined) return;
  const key = JSON.stringify([...new Set(winners)].sort());
  const claimedAt = Date.now();
  const claim = room.memory.crownClaim;
  if (claim !== null && claim.key === key && claimedAt - claim.at < CROWN_REPEAT_MS) return;
  room.memory.crownClaim = { key, at: claimedAt };
  try {
    const { results } = await room.env.DB.prepare(
      'SELECT id, display_name FROM members WHERE group_id = ?',
    )
      .bind(groupId)
      .all<{ id: string; display_name: string }>();
    const names = new Set(winners);
    const ids = results
      .filter((m) => names.has(tableName(m.display_name)))
      .map((m) => m.id)
      .sort();
    const now = Date.now();
    const last = await champions(room);
    if (
      last !== null &&
      now - last.at < CROWN_REPEAT_MS &&
      last.ids.length === ids.length &&
      last.ids.every((id, i) => id === ids[i])
    ) {
      return;
    }
    const crowned: Champions | null = ids.length === 0 ? null : { ids, at: now };
    await room.env.DB.prepare('UPDATE groups SET champions = ? WHERE id = ?')
      .bind(crowned === null ? null : JSON.stringify(crowned), groupId)
      .run();
    room.broadcast({ t: 'champions', champions: crowned });
  } catch (err) {
    console.error('crown failed', { winners }, err);
  }
}

/**
 * Tell the man whose turn it is, on his phone, once.
 *
 * The seat carries the name jaffre was handed on the way in, which is his
 * display name here, so that is the join. Every framed dad relays the same
 * event a few hundred milliseconds apart; the first one sends, the rest
 * find the stamp. Two dads with the same name both hear it, which is the
 * right failure.
 */
async function nudgeTurn(room: Room, name: string): Promise<void> {
  const groupId = room.groupId();
  if (groupId === undefined) return;
  const now = Date.now();
  const last = room.memory.turnNudged.get(name) ?? 0;
  if (now - last < TURN_NUDGE_EVERY_MS) return;
  room.memory.turnNudged.set(name, now);
  try {
    // Compared as the table knows the name: jaffre keeps twenty
    // characters, and a longer dads name would otherwise never match.
    const { results } = await room.env.DB.prepare(
      'SELECT id, display_name FROM members WHERE group_id = ?',
    )
      .bind(groupId)
      .all<{ id: string; display_name: string }>();
    for (const member of results.filter((m) => tableName(m.display_name) === name)) {
      await notifyMember(room.env, member.id, {
        title: 'dads',
        body: 'Your turn at the table.',
        tag: 'table-turn',
      });
    }
  } catch (err) {
    console.error('turn nudge failed', { name }, err);
  }
}
