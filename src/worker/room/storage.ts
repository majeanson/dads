import { parseFit, type ReplyTo, type RoomMessage } from '../../shared/protocol';

/**
 * The object's own SQLite: the tail, the change log and the two timer queues.
 *
 * Two stores, deliberately:
 *   - ctx.storage.sql — the recent tail. Fast, local, survives hibernation.
 *     What a reconnecting client is backfilled from.
 *   - env.DB (D1)     — the archive. Every line is written there too,
 *     because the tail is capped and the group's history is not.
 */
export function initStorage(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tail (
      seq        INTEGER PRIMARY KEY AUTOINCREMENT,
      id         TEXT NOT NULL,
      kind       TEXT NOT NULL,
      member_id  TEXT,
      name       TEXT NOT NULL,
      body       TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      prompt_id  TEXT,
      media_id   TEXT,
      meta       TEXT
    );
    -- Everything that happened to a line after it was said — words or
    -- marks changed, taken back, its picture kept or pruned — in order,
    -- so a socket that resumes without reloading can be told all of it
    -- since the last one it saw (rev). A line changing does not move its
    -- seq, so the backfill by seq never would. Swept in noteChange().
    CREATE TABLE IF NOT EXISTS changes (
      rev  INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      ref  TEXT NOT NULL,
      at   INTEGER NOT NULL
    );
    -- What changes replaced: retractions only, for a day.
    DROP TABLE IF EXISTS retracted;
    CREATE TABLE IF NOT EXISTS leaving (
      member_id TEXT PRIMARY KEY,
      name      TEXT NOT NULL,
      leave_at  INTEGER NOT NULL
    );
    -- Singleton timers by kind ('night_start', 'night_end'). A Durable
    -- Object gets exactly one alarm, so everything that wants to happen
    -- later queues here and rescheduleAlarm() always arms the earliest.
    CREATE TABLE IF NOT EXISTS schedule (
      kind   TEXT PRIMARY KEY,
      due_at INTEGER NOT NULL
    );
  `);
  // Forward migration for rooms created before prompt answers existed.
  // CREATE TABLE IF NOT EXISTS does nothing to a table that is already
  // there, so a new column needs saying out loud.
  const columns = sql
    .exec<{ name: string }>('PRAGMA table_info(tail)')
    .toArray()
    .map((c) => c.name);
  if (!columns.includes('prompt_id')) sql.exec('ALTER TABLE tail ADD COLUMN prompt_id TEXT');
  if (!columns.includes('media_id')) sql.exec('ALTER TABLE tail ADD COLUMN media_id TEXT');
  if (!columns.includes('meta')) sql.exec('ALTER TABLE tail ADD COLUMN meta TEXT');
  if (!columns.includes('reply')) sql.exec('ALTER TABLE tail ADD COLUMN reply TEXT');
  if (!columns.includes('edited_at')) sql.exec('ALTER TABLE tail ADD COLUMN edited_at INTEGER');
}

// A type, not an interface: sql.exec<T> needs an implicit index signature.
export type TailRow = {
  seq: number;
  id: string;
  kind: RoomMessage['kind'];
  member_id: string | null;
  name: string;
  body: string;
  created_at: number;
  prompt_id: string | null;
  media_id: string | null;
  meta: string | null;
  reply: string | null;
  edited_at: number | null;
};

/**
 * Ids in slices D1 can take: it allows about a hundred bound parameters per
 * statement, and a backfill or a resume can name five hundred lines, thirty
 * days of media, or every mark in the tail. Every `IN (...)` in the room is
 * built from one of these, because the one that was not threw while building
 * the hello frame — and a dad whose hello throws reconnects with the same
 * question until he reloads, which from a home screen is never.
 */
const IN_CHUNK = 80;
export function* chunks<T>(ids: readonly T[]): Generator<T[]> {
  for (let i = 0; i < ids.length; i += IN_CHUNK) yield ids.slice(i, i + IN_CHUNK);
}

/** A stored fit, or nothing: NULL, or anything that no longer parses as one. */
export function storedFit(raw: string | null | undefined) {
  if (!raw) return null;
  try {
    return parseFit(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** A stored quote, or nothing: a row from before replies existed has none. */
export function parseReply(raw: string | null | undefined): ReplyTo | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ReplyTo>;
    return typeof v.id === 'string' && typeof v.name === 'string' && typeof v.body === 'string'
      ? { id: v.id, name: v.name, body: v.body }
      : null;
  } catch {
    return null;
  }
}
