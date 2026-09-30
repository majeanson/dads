import {
  MAX_MESSAGE_LENGTH,
  REPLY_QUOTE_LENGTH,
  type Attachment,
  type ClientFrame,
  type ReplyTo,
  type RoomMessage,
} from '../../shared/protocol';
import type { Said } from '../../shared/said';
import { newId } from '../identity';
import { forgetMedia, mediaFor } from '../media';
import { todaysPrompt } from '../prompts';
import { noteChange } from './changes';
import { messagesFrom, reactionsById } from './hydrate';
import type { Room, SocketIdentity } from './room';
import type { TailRow } from './storage';

/** Rows kept in the local tail. Well beyond one evening of talk. */
const TAIL_LIMIT = 500;
/** Backfill for a client that has never connected (no `after`). */
const FRESH_BACKFILL = 80;

/**
 * How long a posted line's cid is remembered, so a re-send after a reconnect
 * does not post it twice.
 *
 * In memory rather than in the tail: a re-send only ever happens seconds to
 * minutes after the first try, and an object that has been evicted for long
 * enough to forget has been idle far longer than that.
 */
const CID_MEMORY_MS = 5 * 60_000;

/** A line a dad typed, answering today's question or not. */
export async function say(
  room: Room,
  ws: WebSocket,
  who: SocketIdentity,
  frame: Extract<ClientFrame, { t: 'chat' | 'prompt' }>,
): Promise<void> {
  const body = frame.body.trim();
  // An attachment is a message in its own right: a photo with no caption is
  // still something said.
  const mediaId = frame.t === 'chat' ? (frame.mediaId ?? null) : null;
  // Every refusal says which line it is about when the sender named one, so
  // the outbox drops that line and not whichever was oldest.
  const held = frame.t === 'chat' && frame.cid !== undefined ? { cid: frame.cid } : {};
  if (!body && mediaId === null) return room.sendTo(ws, { t: 'error', code: 'empty', ...held });
  if ([...body].length > MAX_MESSAGE_LENGTH)
    return room.sendTo(ws, { t: 'error', code: 'too_long', ...held });

  if (frame.t === 'prompt') {
    const groupId = room.groupId();
    // Resolved here rather than trusted from the client: an answer must
    // attach to the question the group was actually asked today.
    const today = groupId ? await todaysPrompt(room.env, groupId) : null;
    if (!today) return room.sendTo(ws, { t: 'error', code: 'no_prompt' });
    await post(room, 'prompt', who.memberId, who.name, body, today.prompt.id);
    return;
  }

  // Resolved here rather than trusted: an id belonging to another group
  // must not become a way to pull a photo out of it.
  //
  // And a man may only hang up what he took. Every id in the room is
  // already on every client, in its own messages, so scoping this to the
  // GROUP alone let one dad put another man's photograph on a line of his
  // own — and since taking a line back takes its picture with it, retracting
  // that line deleted the blob and the record, and the photo disappeared off
  // the line the man who took it had posted, with nothing to put it back.
  //
  // And a picture belongs to ONE line. Nothing a dad can press sends the
  // same id twice, but the protocol allowed it — and because taking a line
  // back takes its picture with it, retracting either of two lines sharing
  // an id deleted the blob out from under the other, leaving a broken
  // photograph on a line nobody had touched.
  const cid = frame.cid;
  const groupId = room.groupId();
  const found = mediaId !== null && groupId ? await mediaFor(room.env, groupId, mediaId) : null;
  if (mediaId !== null && (found === null || found.memberId !== who.memberId)) {
    return room.sendTo(ws, { t: 'error', code: 'no_media', ...held });
  }
  // A phone re-sending what it was holding is not a second use of the
  // picture — it IS that line, arriving twice, and the cid below drops it
  // silently. Refusing it here would send an `error` frame instead, and an
  // error frame drops the oldest line the outbox is holding.
  const resent = cid !== undefined && room.memory.postedCids.has(cid);
  if (mediaId !== null && !resent && groupId && (await alreadyOnALine(room, groupId, mediaId))) {
    return room.sendTo(ws, { t: 'error', code: 'no_media', ...held });
  }
  const media: Attachment | null =
    found === null
      ? null
      : {
          id: found.id,
          name: found.name,
          contentType: found.contentType,
          width: found.width,
          height: found.height,
          kept: found.kept,
        };

  // A dad whose phone lost the signal re-sends what it was holding. If the
  // room got it the first time, the second copy is the same line and not a
  // second thing said — and what he is missing is the echo, so he gets it.
  if (cid !== undefined) {
    const posted = alreadyPosted(room, cid);
    if (posted !== null) return echo(room, ws, posted, cid);
  }

  // What he is answering, as a snapshot taken now: an id the room cannot
  // find is dropped quietly and the line still posts, because the words
  // he typed are the thing and the quote is the context.
  const reply = frame.replyTo === undefined ? null : await quoteOf(room, frame.replyTo);

  await post(room, 'chat', who.memberId, who.name, body, null, media, null, cid, reply);
}

/**
 * The line an answer points at, cut down to a quote. The tail first, then
 * the archive: a man may answer something older than five hundred lines.
 * Only what a dad typed is quotable — the room's own lines are facts, and
 * nobody replies to a fact.
 */
async function quoteOf(room: Room, id: string): Promise<ReplyTo | null> {
  const cut = (body: string) =>
    [...body].length > REPLY_QUOTE_LENGTH
      ? [...body].slice(0, REPLY_QUOTE_LENGTH - 1).join('') + '…'
      : body;
  const local = room.sql
    .exec<{ name: string; body: string; kind: string; member_id: string | null }>(
      'SELECT name, body, kind, member_id FROM tail WHERE id = ?',
      id,
    )
    .toArray()[0];
  if (local !== undefined) {
    if (local.member_id === null || (local.kind !== 'chat' && local.kind !== 'prompt')) return null;
    return { id, name: local.name, body: cut(local.body) };
  }
  const groupId = room.groupId();
  if (groupId === undefined) return null;
  const row = await room.env.DB.prepare(
    `SELECT m.body, m.kind, m.member_id, mem.display_name AS name
       FROM messages m LEFT JOIN members mem ON mem.id = m.member_id
      WHERE m.id = ? AND m.group_id = ?`,
  )
    .bind(id, groupId)
    .first<{ body: string; kind: string; member_id: string | null; name: string | null }>();
  if (row === null || row.member_id === null || (row.kind !== 'chat' && row.kind !== 'prompt'))
    return null;
  return { id, name: row.name ?? '', body: cut(row.body) };
}

/**
 * Change the words of a line. His own, and only what he typed — the same
 * rule as taking one back, checked the same way: the archive first, the
 * tail too, so a line whose archive write failed is still his to fix.
 * Everyone is told, the editor included: like a retraction, this is not
 * optimistic, because what he sees should be what the room has.
 */
export async function edit(
  room: Room,
  ws: WebSocket,
  id: string,
  memberId: string,
  raw: string,
): Promise<void> {
  const body = raw.trim();
  if (!body) return room.sendTo(ws, { t: 'error', code: 'empty' });
  if ([...body].length > MAX_MESSAGE_LENGTH)
    return room.sendTo(ws, { t: 'error', code: 'too_long' });

  const groupId = room.groupId();
  const own = (kind: string | undefined, owner: string | null | undefined) =>
    owner === memberId && (kind === 'chat' || kind === 'prompt');
  let mine = false;
  if (groupId !== undefined) {
    const row = await room.env.DB.prepare(
      'SELECT member_id, kind FROM messages WHERE id = ? AND group_id = ?',
    )
      .bind(id, groupId)
      .first<{ member_id: string | null; kind: string }>();
    if (row !== null) mine = own(row.kind, row.member_id);
  }
  const local = room.sql
    .exec<{ member_id: string | null; kind: string }>(
      'SELECT member_id, kind FROM tail WHERE id = ?',
      id,
    )
    .toArray()[0];
  if (!mine && local !== undefined) mine = own(local.kind, local.member_id);
  if (!mine) return;

  const editedAt = Date.now();
  room.sql.exec(
    'UPDATE tail SET body = ?, edited_at = ? WHERE id = ? AND member_id = ?',
    body,
    editedAt,
    id,
    memberId,
  );
  room.broadcast({ t: 'edited', id, body, editedAt, rev: noteChange(room, 'line', id) });
  if (groupId !== undefined) {
    await room.env.DB.prepare(
      'UPDATE messages SET body = ?, edited_at = ? WHERE id = ? AND group_id = ? AND member_id = ?',
    )
      .bind(body, editedAt, id, groupId, memberId)
      .run()
      .catch((err: unknown) => console.error('edit: archive kept the old words', { id }, err));
  }
}

/**
 * A line taken back, everywhere it exists.
 *
 * The ARCHIVE is the authority on who said what: the tail holds the last
 * five hundred lines and the photograph a man regrets may be older than
 * that. The tail is consulted as well, because an archive write can fail
 * and a line that only ever made it into the room is still his to withdraw.
 *
 * Only what he typed — `chat` and `prompt`. The room's own lines carry no
 * member id and are nobody's to edit; the check is belt and braces.
 *
 * Silence on refusal, deliberately: this is not a route a stranger can
 * reach, and telling a caller whether an id exists in somebody else's room
 * is information it has no reason to have.
 */
export async function retract(room: Room, id: string, memberId: string): Promise<void> {
  const groupId = room.groupId();
  const own = (kind: string | undefined, owner: string | null | undefined) =>
    owner === memberId && (kind === 'chat' || kind === 'prompt');

  let mediaId: string | null = null;
  let mine = false;

  if (groupId !== undefined) {
    const row = await room.env.DB.prepare(
      'SELECT member_id, media_id, kind FROM messages WHERE id = ? AND group_id = ?',
    )
      .bind(id, groupId)
      .first<{ member_id: string | null; media_id: string | null; kind: string }>();
    if (row !== null) {
      mine = own(row.kind, row.member_id);
      mediaId = row.media_id;
    }
  }

  const local = room.sql
    .exec<{ member_id: string | null; media_id: string | null; kind: string }>(
      'SELECT member_id, media_id, kind FROM tail WHERE id = ?',
      id,
    )
    .toArray()[0];
  if (!mine && local !== undefined) {
    mine = own(local.kind, local.member_id);
    mediaId ??= local.media_id;
  }
  if (!mine) return;

  if (groupId !== undefined) {
    await room.env.DB.prepare(
      'DELETE FROM messages WHERE id = ? AND group_id = ? AND member_id = ?',
    )
      .bind(id, groupId, memberId)
      .run();
  }
  room.sql.exec('DELETE FROM tail WHERE id = ? AND member_id = ?', id, memberId);

  // The picture goes with the line it was on. Half the reason for taking a
  // line back is the thing attached to it.
  if (mediaId !== null && groupId !== undefined) {
    await forgetMedia(room.env, groupId, mediaId).catch((err: unknown) => {
      console.error('retract: media survived', { mediaId }, err);
    });
  }

  // The quotes of it go too.
  //
  // A reply carries a SNAPSHOT so it survives the original scrolling out of
  // the backfill or being changed afterwards. Being taken back is the one
  // case where surviving is wrong: the words are on everyone's screen
  // again, under somebody's answer, and "then it is gone" has to mean gone.
  // The answer keeps his own words and loses the context. Every open socket
  // works this out from the `gone` frame itself; this is what makes a
  // reload agree with what they are already looking at.
  await unquote(room, id);

  room.broadcast({ t: 'gone', id, rev: noteChange(room, 'gone', id) });
}

/**
 * Take a line out of the quotes that answer it.
 *
 * Matched on the id INSIDE the stored JSON rather than by holding a list of
 * who quoted whom: a quote is rare, a retraction is rarer, and a second
 * table to keep in step with both is a worse thing to own than one scan.
 */
async function unquote(room: Room, id: string): Promise<void> {
  room.sql.exec(
    "UPDATE tail SET reply = NULL WHERE reply IS NOT NULL AND json_extract(reply, '$.id') = ?",
    id,
  );
  const groupId = room.groupId();
  if (groupId === undefined) return;
  await room.env.DB.prepare(
    `UPDATE messages SET reply = NULL
      WHERE group_id = ? AND reply IS NOT NULL AND json_extract(reply, '$.id') = ?`,
  )
    .bind(groupId, id)
    .run()
    .catch((err: unknown) => console.error('retract: a quote of it survived', { id }, err));
}

/**
 * A mark on a line, or a mark taken off.
 *
 * D1 only: a reaction has to outlive an eviction, and the room's tail is
 * the live half. The write is scoped to the group on the way in, so an id
 * from somebody else's room writes nothing — and the read that follows is
 * what everyone is told, so a refused write shows up as no change rather
 * than as a lie on one screen.
 *
 * The emoji reached here through the allowlist in `parseClientFrame`; this
 * does not re-check it, but nothing else may call this.
 */
export async function react(
  room: Room,
  id: string,
  memberId: string,
  emoji: string,
  on: boolean,
): Promise<void> {
  const groupId = room.groupId();
  if (groupId === undefined) return;

  try {
    if (on) {
      // The line has to be this group's. Selecting it into the INSERT is
      // what makes a stray id from another room a no-op rather than a row.
      await room.env.DB.prepare(
        `INSERT OR IGNORE INTO reactions (message_id, member_id, emoji, group_id, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5 FROM messages WHERE id = ?1 AND group_id = ?4`,
      )
        .bind(id, memberId, emoji, groupId, Date.now())
        .run();
    } else {
      await room.env.DB.prepare(
        `DELETE FROM reactions
          WHERE message_id = ? AND member_id = ? AND emoji = ? AND group_id = ?`,
      )
        .bind(id, memberId, emoji, groupId)
        .run();
    }
    const all = await reactionsById(room, [id]);
    room.broadcast({
      t: 'reacted',
      id,
      reactions: all.get(id) ?? [],
      rev: noteChange(room, 'line', id),
    });
  } catch (err) {
    // Nobody is waiting on this and nothing downstream depends on it. A
    // mark that did not land is a mark a man can press again.
    console.error('react failed', { id, emoji }, err);
  }
}

/**
 * Whether this picture is already on a line.
 *
 * The archive rather than the tail: an id a client offers can be as old as
 * anything it was handed in a backfill, and the tail holds five hundred
 * lines. One query, and only when a line carries an attachment at all.
 */
async function alreadyOnALine(room: Room, groupId: string, mediaId: string): Promise<boolean> {
  const row = await room.env.DB.prepare(
    'SELECT 1 AS n FROM messages WHERE group_id = ? AND media_id = ? LIMIT 1',
  )
    .bind(groupId, mediaId)
    .first<{ n: number }>();
  return row !== null;
}

/** The line a cid already became, or null the first time it is offered. */
function alreadyPosted(room: Room, cid: string, now = Date.now()): string | null {
  const posted = room.memory.postedCids;
  for (const [seen, { at }] of posted) {
    if (now - at > CID_MEMORY_MS) posted.delete(seen);
  }
  return posted.get(cid)?.id ?? null;
}

/**
 * A re-sent line, answered with the line it already is.
 *
 * The phone that sends a cid twice is one whose socket died between the
 * room taking the line and the echo reaching it. It holds the line until it
 * sees its own id come back, and dropping the repeat in silence left it
 * holding for ever: eight seconds on, it closed a perfectly good socket to
 * try again, was ignored again, and closed again — three tries, two
 * reconnects, "1 line waiting" under a line already on its screen. The
 * repeat gets the echo the first send did not deliver, to that socket
 * only; if the line has since been taken back, it gets a refusal that
 * names it, which is what lets the outbox let go.
 */
async function echo(room: Room, ws: WebSocket, id: string, cid: string): Promise<void> {
  const row = room.sql.exec<TailRow>('SELECT * FROM tail WHERE id = ?', id).toArray()[0];
  if (row === undefined) return room.sendTo(ws, { t: 'error', code: 'gone', cid });
  const message = (await messagesFrom(room, [row]))[0];
  if (message !== undefined) room.sendTo(ws, { t: 'msg', message, cid });
}

async function post(
  room: Room,
  kind: RoomMessage['kind'],
  memberId: string | null,
  name: string,
  body: string,
  promptId: string | null = null,
  media: Attachment | null = null,
  said: Said | null = null,
  cid?: string,
  reply: ReplyTo | null = null,
): Promise<void> {
  const id = newId('msg');
  const createdAt = Date.now();
  // Remembered by the sender's own id for it, so a re-send after a dropped
  // echo can be answered with THIS line rather than posted again.
  if (cid !== undefined) room.memory.postedCids.set(cid, { at: createdAt, id });

  const meta = said === null ? null : JSON.stringify(said);
  const seq = room.sql
    .exec<{ seq: number }>(
      `INSERT INTO tail (id, kind, member_id, name, body, created_at, prompt_id, media_id, meta, reply)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING seq`,
      id,
      kind,
      memberId,
      name,
      body,
      createdAt,
      promptId,
      media?.id ?? null,
      meta,
      reply === null ? null : JSON.stringify(reply),
    )
    .one().seq;
  room.sql.exec(`DELETE FROM tail WHERE seq <= (SELECT MAX(seq) FROM tail) - ?`, TAIL_LIMIT);

  const message: RoomMessage = {
    seq,
    id,
    kind,
    memberId,
    name,
    body,
    createdAt,
    promptId,
    media,
    said,
    reply,
  };
  // Fan out before the archive write: a dad should not wait on D1 to see
  // his own line appear.
  room.broadcast(cid === undefined ? { t: 'msg', message } : { t: 'msg', message, cid });
  await archive(room, message);
}

async function archive(room: Room, message: RoomMessage): Promise<void> {
  const groupId = room.groupId();
  if (!groupId) return;
  try {
    await room.env.DB.prepare(
      `INSERT INTO messages
         (id, group_id, member_id, kind, body, created_at, prompt_id, media_id, meta, reply)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        message.id,
        groupId,
        message.memberId,
        message.kind,
        message.body,
        message.createdAt,
        message.promptId ?? null,
        message.media?.id ?? null,
        message.said === null || message.said === undefined ? null : JSON.stringify(message.said),
        message.reply === null || message.reply === undefined
          ? null
          : JSON.stringify(message.reply),
      )
      .run();
  } catch (err) {
    // The line already reached every dad and is in the tail. Losing the
    // archive row is a real problem, but not one to surface as a failed
    // send; it is logged so it can be seen.
    console.error('archive failed', { messageId: message.id, groupId }, err);
  }
}

/** What a socket is handed on hello: everything after `after`, or the last
 * few dozen lines for a socket that has never been here. */
export async function backfill(room: Room, after: number | null): Promise<RoomMessage[]> {
  const rows =
    after === null
      ? room.sql
          .exec<TailRow>('SELECT * FROM tail ORDER BY seq DESC LIMIT ?', FRESH_BACKFILL)
          .toArray()
          .reverse()
      : room.sql
          .exec<TailRow>('SELECT * FROM tail WHERE seq > ? ORDER BY seq ASC', after)
          .toArray();
  return messagesFrom(room, rows);
}

/**
 * Take something back out of the room's own memory.
 *
 * The archive in D1 can be edited with a SQL statement; this cannot. The
 * object keeps its own capped tail and serves the backfill from it, so a
 * line deleted from D1 goes on appearing for everybody until 500 more have
 * been said — which for five friends is never.
 *
 * Only the Worker can reach this, and the Worker only exposes it behind an
 * ops secret that is not set unless somebody deliberately sets it.
 */
export function forget(room: Room, like: string): number {
  const before = room.sql
    .exec<{ n: number }>('SELECT COUNT(*) AS n FROM tail WHERE body LIKE ?', like)
    .one().n;
  room.sql.exec('DELETE FROM tail WHERE body LIKE ?', like);
  return before;
}
