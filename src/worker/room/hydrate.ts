import type { Attachment, Reaction, RoomMessage } from '../../shared/protocol';
import { parseSaid } from '../../shared/said';
import type { Room } from './room';
import { chunks, parseReply, type TailRow } from './storage';

/** Tail rows as the lines a client is handed, attachments and marks on. */
export async function messagesFrom(room: Room, rows: TailRow[]): Promise<RoomMessage[]> {
  const wanted = [...new Set(rows.map((r) => r.media_id).filter((id) => id !== null))];
  const [attachments, reactions] = await Promise.all([
    attachmentsById(room, wanted),
    // Only what a dad typed can carry a mark, so the room's own lines are
    // not worth asking about.
    reactionsById(
      room,
      rows.filter((r) => r.member_id !== null).map((r) => r.id),
    ),
  ]);

  return rows.map((r) => ({
    seq: r.seq,
    id: r.id,
    kind: r.kind,
    memberId: r.member_id,
    name: r.name,
    body: r.body,
    createdAt: r.created_at,
    promptId: r.prompt_id,
    media: r.media_id === null ? null : (attachments.get(r.media_id) ?? null),
    reactions: reactions.get(r.id),
    // A line from before the room knew how to say things twice has no meta,
    // and its English body is what it keeps.
    said: parseSaid(r.meta),
    reply: parseReply(r.reply),
    editedAt: r.edited_at ?? null,
  }));
}

/**
 * Attachments are hydrated from D1 rather than stored in the tail on
 * purpose: the ten-photo cap means a blob can be gone by the time anyone
 * reconnects, and looking it up means that line quietly loses its picture
 * instead of showing a broken one forever.
 */
export async function attachmentsById(room: Room, ids: string[]): Promise<Map<string, Attachment>> {
  const found = new Map<string, Attachment>();
  const groupId = room.groupId();
  if (ids.length === 0 || !groupId) return found;

  // D1 allows around a hundred bound parameters per statement, and the tail
  // holds up to 500 rows. Media is capped at ten LIVE per group, but pruned
  // ids stay in tail.media_id forever, so a long-running room can easily
  // carry more distinct ids than that in one backfill. Unchunked, a
  // reconnect would throw, the hello frame would never be built, and that
  // dad would be stuck in a reconnect loop he could not get out of.
  for (const slice of chunks(ids)) {
    const placeholders = slice.map(() => '?').join(', ');
    const { results } = await room.env.DB.prepare(
      `SELECT id, name, content_type, width, height, kept FROM media
        WHERE group_id = ? AND id IN (${placeholders})`,
    )
      .bind(groupId, ...slice)
      .all<{
        id: string;
        name: string;
        content_type: string;
        width: number | null;
        height: number | null;
        kept: number;
      }>();

    for (const row of results) {
      found.set(row.id, {
        id: row.id,
        name: row.name,
        contentType: row.content_type,
        width: row.width,
        height: row.height,
        kept: row.kept === 1,
      });
    }
  }
  return found;
}

/** Marks on a set of lines, oldest first within each. */
export async function reactionsById(room: Room, ids: string[]): Promise<Map<string, Reaction[]>> {
  const found = new Map<string, Reaction[]>();
  const groupId = room.groupId();
  if (ids.length === 0 || groupId === undefined) return found;

  // Chunked for the same reason the attachments are: D1 takes about a
  // hundred bound parameters and a backfill can carry five hundred lines.
  for (const slice of chunks(ids)) {
    const placeholders = slice.map(() => '?').join(', ');
    const { results } = await room.env.DB.prepare(
      `SELECT message_id, member_id, emoji FROM reactions
        WHERE group_id = ? AND message_id IN (${placeholders})
        ORDER BY created_at ASC`,
    )
      .bind(groupId, ...slice)
      .all<{ message_id: string; member_id: string; emoji: string }>();

    for (const row of results) {
      const list = found.get(row.message_id) ?? [];
      const mark = list.find((r) => r.emoji === row.emoji);
      if (mark) mark.by.push(row.member_id);
      else list.push({ emoji: row.emoji, by: [row.member_id] });
      found.set(row.message_id, list);
    }
  }
  return found;
}
