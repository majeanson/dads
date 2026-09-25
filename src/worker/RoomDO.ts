import { DurableObject } from 'cloudflare:workers';
import { currentWindow, isValidNight, nextStart, type DadNight } from '../shared/dadNight';
import {
  MAX_MESSAGE_LENGTH,
  type Attachment,
  parseClientFrame,
  type CallMember,
  type Champions,
  type LineState,
  type RoomMessage,
  type RoomsOpen,
  type Reaction,
  type RosterEntry,
  type ServerFrame,
} from '../shared/protocol';
import { tableName } from '../shared/jaffre';
import { parseSaid, type Said } from '../shared/said';
import { isGlasses, parseFit, REPLY_QUOTE_LENGTH, type ReplyTo } from '../shared/protocol';

/** A stored fit, or nothing: NULL, or anything that no longer parses as one. */
function storedFit(raw: string | null | undefined) {
  if (!raw) return null;
  try {
    return parseFit(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** A stored quote, or nothing: a row from before replies existed has none. */
function parseReply(raw: string | null | undefined): ReplyTo | null {
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
import { dadNightReminder, notifyGroup, notifyMember } from './push';
import type { Env } from './env';
import { newId } from './identity';
import { forgetMedia, mediaFor } from './media';
import { todaysPrompt } from './prompts';

/**
 * One Durable Object per group. Owns the LIVE half of the room: who is
 * connected, the chat fan-out, typing, and (from M6) relayed table events.
 *
 * Two stores, deliberately:
 *   - this.ctx.storage.sql — the recent tail. Fast, local, survives
 *     hibernation. What a reconnecting client is backfilled from.
 *   - env.DB (D1)         — the archive. Every line is written there too,
 *     because the DO's tail is capped and the group's history is not.
 *
 * Identity is never established here. The Worker verified the cookie and
 * forwards it in headers; nothing but the Worker can reach this object.
 */

/** Trusted headers set by the Worker on the forwarded upgrade request. */
export const IDENTITY_HEADERS = {
  groupId: 'X-Dads-Group-Id',
  memberId: 'X-Dads-Member-Id',
  name: 'X-Dads-Name',
  /** When he last set his face, so the roster can carry it. Absent: no face. */
  face: 'X-Dads-Face',
  /** The group's dad night as JSON, or absent for a group with none set. */
  night: 'X-Dads-Night',
} as const;

/** Rows kept in the local tail. Well beyond one evening of talk. */
const TAIL_LIMIT = 500;
/** Backfill for a client that has never connected (no `after`). */
const FRESH_BACKFILL = 80;

/**
 * A phone hopping between wifi and LTE closes and reopens its socket in a few
 * seconds. Without this, every hop would print "Marc left" / "Marc came in".
 */
const LEAVE_GRACE_MS = 15_000;

/** A hand takes a minute or two; a nudge per hand is a nag. */
const TURN_NUDGE_EVERY_MS = 3 * 60_000;

/**
 * How long a posted line's cid is remembered, so a re-send after a reconnect
 * does not post it twice.
 *
 * In memory rather than in the tail: a re-send only ever happens seconds to
 * minutes after the first try, and an object that has been evicted for long
 * enough to forget has been idle far longer than that.
 */
const CID_MEMORY_MS = 5 * 60_000;

/**
 * Ids in slices D1 can take: it allows about a hundred bound parameters per
 * statement, and a backfill or a resume can name five hundred lines, thirty
 * days of media, or every mark in the tail. Every `IN (...)` in here is built
 * from one of these, because the one that was not threw while building the
 * hello frame — and a dad whose hello throws reconnects with the same
 * question until he reloads, which from a home screen is never.
 */
const IN_CHUNK = 80;
function* chunks<T>(ids: readonly T[]): Generator<T[]> {
  for (let i = 0; i < ids.length; i += IN_CHUNK) yield ids.slice(i, i + IN_CHUNK);
}

/**
 * How far back the room remembers what happened to lines it had already said.
 *
 * A socket that resumes rather than reloads asks for everything after the
 * last change it saw (`?rev=`), and a home-screen app can sleep for DAYS
 * before it does: a one-day window let a photograph taken back on Monday
 * stay on a phone that woke on Thursday. Past these bounds the room does not
 * guess — it hands the phone a fresh backfill to replace what it holds.
 */
const CHANGE_MEMORY_MS = 30 * 24 * 60 * 60 * 1000;
const CHANGE_MEMORY_ROWS = 5000;

/** Every framed dad relays the same game-over; one crown per game. */
const CROWN_REPEAT_MS = 60_000;

/** What changed: a line's words or marks, a line taken back, or a picture. */
type ChangeKind = 'line' | 'gone' | 'media';

/** How long before the table opens the phones are told. The evening before,
 * while a man can still move something. */
const REMIND_BEFORE_MS = 24 * 60 * 60 * 1000;

/** What a live socket remembers about who is on the other end of it. Named
 * for its job rather than for serializeAttachment, so it does not collide
 * with a message's Attachment. */
interface SocketIdentity {
  memberId: string;
  name: string;
  /** The version of his face, for the roster. Absent means he has none. */
  face?: number;
  /** His microphone is off. Held with `inCall` and for the same reason: it is
   * true only while this socket is. */
  muted?: boolean;
  /** Whether this connection has its microphone in the room. Held on the
   * socket rather than in storage because it is true only while the socket
   * is: a dropped connection is off the call by definition. */
  inCall?: boolean;
}

// A type, not an interface: sql.exec<T> needs an implicit index signature.
type TailRow = {
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

export class RoomDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keepalive that never wakes a hibernating object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
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
      const columns = ctx.storage.sql
        .exec<{ name: string }>('PRAGMA table_info(tail)')
        .toArray()
        .map((c) => c.name);
      if (!columns.includes('prompt_id')) {
        ctx.storage.sql.exec('ALTER TABLE tail ADD COLUMN prompt_id TEXT');
      }
      if (!columns.includes('media_id')) {
        ctx.storage.sql.exec('ALTER TABLE tail ADD COLUMN media_id TEXT');
      }
      if (!columns.includes('meta')) {
        ctx.storage.sql.exec('ALTER TABLE tail ADD COLUMN meta TEXT');
      }
      if (!columns.includes('reply')) {
        ctx.storage.sql.exec('ALTER TABLE tail ADD COLUMN reply TEXT');
      }
      if (!columns.includes('edited_at')) {
        ctx.storage.sql.exec('ALTER TABLE tail ADD COLUMN edited_at INTEGER');
      }
    });
  }

  // ---------------------------------------------------------------- upgrade

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ ok: true, id: this.ctx.id.toString() });
    }

    // The group's night changed while dads were connected. Only the Worker
    // can reach this.
    if (url.pathname === '/night' && request.method === 'POST') {
      const { night } = (await request.json()) as { night: DadNight | null };
      this.applyNight(night);
      this.broadcast({ t: 'night', night });
      await this.rescheduleAlarm();
      return new Response(null, { status: 204 });
    }

    // Somebody marked the calendar that picks the next night. A nudge to
    // re-read, nothing more: see the `poll` frame in protocol.ts.
    if (url.pathname === '/poll' && request.method === 'POST') {
      this.broadcast({ t: 'poll' });
      return new Response(null, { status: 204 });
    }

    // A screen that reads over HTTP should look again. Only the Worker can
    // reach this; see the `stir` frame in protocol.ts for why it exists.
    if (url.pathname === '/stir' && request.method === 'POST') {
      const { what } = (await request.json()) as { what: 'night' | 'todo' | 'table' };
      if (what !== 'night' && what !== 'todo' && what !== 'table') {
        return new Response('bad stir', { status: 400 });
      }
      this.broadcast({ t: 'stir', what });
      return new Response(null, { status: 204 });
    }

    // What the group has open changed. Nothing is said in the conversation —
    // a switch is not news — but every open room finds out at once.
    if (url.pathname === '/rooms' && request.method === 'POST') {
      const rooms = (await request.json()) as RoomsOpen;
      this.broadcast({ t: 'rooms', rooms });
      return new Response(null, { status: 204 });
    }

    // A picture was taken off the shelf, or put back on it. Nothing is said —
    // keeping a photograph is not news, the same as a face changing — but
    // whether it survives the next upload is a fact about the room, so every
    // open phone hears it rather than only the one that asked. The Worker has
    // already written it to D1.
    // The room changed hands. Nothing is said here — the route says it, by
    // name, like the night — this only carries the fact to open phones.
    if (url.pathname === '/owner' && request.method === 'POST') {
      const { createdBy } = (await request.json()) as { createdBy: string | null };
      this.broadcast({ t: 'owner', createdBy });
      return new Response(null, { status: 204 });
    }

    if (url.pathname === '/kept' && request.method === 'POST') {
      const { mediaId, on } = (await request.json()) as { mediaId: string; on: boolean };
      const rev = this.noteChange('media', mediaId);
      this.broadcast({ t: 'kept', mediaId, on, rev });
      return new Response(null, { status: 204 });
    }

    // Pictures an upload pushed off the shelf. The Worker has deleted them;
    // every open phone is still showing them, and only the uploader was told.
    if (url.pathname === '/unshelved' && request.method === 'POST') {
      const { mediaIds } = (await request.json()) as { mediaIds: string[] };
      if (mediaIds.length === 0) return new Response(null, { status: 204 });
      let rev = 0;
      for (const id of mediaIds) rev = this.noteChange('media', id);
      this.broadcast({ t: 'unshelved', mediaIds, rev });
      return new Response(null, { status: 204 });
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
    /**
     * A dad changed his name or his face.
     *
     * His own open sockets are carrying the old one, and the roster is built
     * from those attachments — so without this the other four would go on
     * seeing the old name until he happened to reconnect. Only the Worker can
     * reach this, and it has already written the change to D1.
     */
    if (url.pathname === '/member' && request.method === 'POST') {
      const { groupId, memberId, name, face } = (await request.json()) as {
        groupId: string;
        memberId: string;
        name: string;
        face: number | null;
        was?: string;
      };
      // The object learns its group id from a socket upgrade, and this can be
      // the first thing it ever hears — a dad who renames himself before any
      // connection would otherwise get a line the archive never sees.
      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO meta (key, value) VALUES ('group_id', ?)`,
        groupId,
      );
      for (const ws of this.ctx.getWebSockets(memberId)) {
        const who = ws.deserializeAttachment() as SocketIdentity | null;
        if (who !== null) {
          ws.serializeAttachment({
            ...who,
            name,
            face: face ?? undefined,
          } satisfies SocketIdentity);
        }
      }
      this.broadcastRoster();
      // And who he is, which reaches his old lines as well as the roster —
      // a face set tonight belongs beside what he said on Tuesday. The pair
      // he wears is read here rather than carried in: a change of name or
      // face does not know it, and a frame without it would take his glasses
      // off every screen. Where they sit on his photo, the same.
      const worn = await this.env.DB.prepare(
        'SELECT glasses, glasses_fit FROM members WHERE id = ?',
      )
        .bind(memberId)
        .first<{ glasses: string | null; glasses_fit: string | null }>()
        .catch(() => null);
      const fit = storedFit(worn?.glasses_fit);
      this.broadcast({
        t: 'member',
        member: {
          memberId,
          name,
          face: face ?? undefined,
          ...(isGlasses(worn?.glasses) ? { glasses: worn.glasses } : {}),
          ...(fit ? { fit } : {}),
        },
      });

      return Response.json({ ok: true });
    }

    if (url.pathname === '/forget' && request.method === 'POST') {
      const { like } = (await request.json()) as { like?: unknown };
      if (typeof like !== 'string' || like.length < 4 || like.length > 200) {
        return new Response('bad pattern', { status: 400 });
      }
      const before = this.ctx.storage.sql
        .exec<{ n: number }>('SELECT COUNT(*) AS n FROM tail WHERE body LIKE ?', like)
        .one().n;
      this.ctx.storage.sql.exec('DELETE FROM tail WHERE body LIKE ?', like);
      return Response.json({ dropped: before });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }

    const groupId = request.headers.get(IDENTITY_HEADERS.groupId);
    const memberId = request.headers.get(IDENTITY_HEADERS.memberId);
    const name = request.headers.get(IDENTITY_HEADERS.name);
    if (!groupId || !memberId || !name) {
      return new Response('missing identity', { status: 400 });
    }
    // The group id is the DO's identity for D1 writes; remember it the first
    // time so alarms (which carry no request) can archive too.
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO meta (key, value) VALUES ('group_id', ?)`,
      groupId,
    );

    // Every connection re-states the schedule. Cheap when unchanged, and it
    // means a room whose night was set before it ever had a socket still
    // arms itself the first time someone shows up.
    const nightHeader = request.headers.get(IDENTITY_HEADERS.night);
    this.applyNight(nightHeader ? (JSON.parse(nightHeader) as DadNight) : null);
    await this.rescheduleAlarm();

    const after = Number(url.searchParams.get('after') ?? '');
    const since = Number(url.searchParams.get('rev') ?? '');

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    const wasPresent = this.isPresent(memberId);
    this.ctx.acceptWebSocket(server, [memberId]);
    const faceHeader = Number(request.headers.get(IDENTITY_HEADERS.face) ?? '');
    const face = Number.isFinite(faceHeader) && faceHeader > 0 ? faceHeader : undefined;
    server.serializeAttachment({ memberId, name, face } satisfies SocketIdentity);

    // A resume is only a resume if the room can say everything that happened
    // since: a `rev` it no longer remembers back to (or none at all, from a
    // build before there was one) gets a fresh backfill to replace with.
    const resuming =
      Number.isFinite(after) &&
      after > 0 &&
      url.searchParams.has('rev') &&
      Number.isInteger(since) &&
      since >= 0 &&
      this.remembersSince(since);
    const members = await this.membersOfGroup();
    const replay = resuming ? await this.replaySince(since) : null;
    const hello: ServerFrame = {
      t: 'hello',
      you: { memberId, name },
      roster: this.roster(),
      call: this.callRoster(),
      members,
      messages: await this.backfill(resuming ? after : null),
      rev: this.currentRev(),
      fresh: !resuming,
      gone: replay?.gone ?? [],
      changed: replay?.changed ?? [],
      media: replay?.media ?? [],
      champions: await this.champions(),
    };
    server.send(JSON.stringify(hello));

    if (!wasPresent) {
      const wasLeaving = this.cancelLeave(memberId);
      // A dad back within the grace window never left, as far as the room is
      // concerned; only a genuine arrival gets a line. His pending alarm goes
      // with the row, so the object is not woken for nothing.
      if (wasLeaving) await this.rescheduleAlarm();
      else await this.notePresence(memberId, name, 'in');
      this.broadcastRoster();
      // And WHO he is, not just that he is here.
      //
      // `members` — everyone in the group, present or not — was only ever
      // built at hello, so a dad who was already connected when somebody new
      // came through the door did not have him in it until a reload. His
      // face was missing from his lines, and he could not be picked in a list
      // of the group's men. The frame is an upsert on every client, so
      // sending it on each genuine arrival costs a message and settles it.
      // His own row from the list just read for the hello, so the glasses he
      // wears arrive with him.
      const own = members.find((m) => m.memberId === memberId);
      this.broadcast({
        t: 'member',
        member: {
          memberId,
          name,
          ...(face ? { face } : {}),
          ...(own?.glasses ? { glasses: own.glasses } : {}),
          ...(own?.fit ? { fit: own.fit } : {}),
        },
      });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // --------------------------------------------------------------- sockets

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const who = ws.deserializeAttachment() as SocketIdentity | null;
    if (!who) return;

    const frame = parseClientFrame(raw);
    if (!frame) return this.sendTo(ws, { t: 'error', code: 'bad_frame' });

    if (frame.t === 'typing') {
      this.broadcast({ t: 'typing', memberId: who.memberId, name: who.name }, ws);
      return;
    }

    if (frame.t === 'call') {
      // The attachment is the only record, so it must be rewritten whole.
      ws.serializeAttachment({
        ...who,
        inCall: frame.join,
        muted: frame.muted === true,
      } satisfies SocketIdentity);
      this.broadcastCallRoster();
      if (!frame.join) {
        // Tell the others to tear down their side rather than leave them
        // holding a connection to somebody who has gone.
        this.broadcast(
          { t: 'rtc', from: who.memberId, name: who.name, payload: { hangup: true } },
          ws,
        );
      }
      return;
    }

    if (frame.t === 'rtc') {
      // Relayed verbatim to one dad, with the sender named by the room rather
      // than by the sender: a browser cannot claim to be somebody else.
      const relayed = JSON.stringify({
        t: 'rtc',
        from: who.memberId,
        name: who.name,
        payload: frame.payload,
      });
      for (const target of this.ctx.getWebSockets(frame.to)) {
        try {
          target.send(relayed);
        } catch {
          // A socket mid-close; webSocketClose will deal with it.
        }
      }
      return;
    }

    if (frame.t === 'table') {
      // The frame still comes, and still does exactly one thing: his turn has
      // sat for twenty seconds, so his phone hears about it. What the table
      // is doing is on the table, which is on the screen beside this.
      if (frame.event.t === 'turn') await this.nudgeTurn(frame.event.name);
      // And one more (2026-09-24): a game that ends names who won it, and
      // they wear gold glasses until the next one does.
      if (frame.event.t === 'game-over' && frame.event.winners !== undefined) {
        await this.crown(frame.event.winners);
      }
      return;
    }

    if (frame.t === 'retract') {
      await this.retract(frame.id, who.memberId);
      return;
    }

    if (frame.t === 'react') {
      await this.react(frame.id, who.memberId, frame.emoji, frame.on);
      return;
    }

    if (frame.t === 'edit') {
      await this.edit(ws, frame.id, who.memberId, frame.body);
      return;
    }

    const body = frame.body.trim();
    // An attachment is a message in its own right: a photo with no caption is
    // still something said.
    const mediaId = frame.t === 'chat' ? (frame.mediaId ?? null) : null;
    // Every refusal says which line it is about when the sender named one, so
    // the outbox drops that line and not whichever was oldest.
    const held = frame.t === 'chat' && frame.cid !== undefined ? { cid: frame.cid } : {};
    if (!body && mediaId === null) return this.sendTo(ws, { t: 'error', code: 'empty', ...held });
    if ([...body].length > MAX_MESSAGE_LENGTH)
      return this.sendTo(ws, { t: 'error', code: 'too_long', ...held });

    if (frame.t === 'prompt') {
      const groupId = this.groupId();
      // Resolved here rather than trusted from the client: an answer must
      // attach to the question the group was actually asked today.
      const today = groupId ? await todaysPrompt(this.env, groupId) : null;
      if (!today) return this.sendTo(ws, { t: 'error', code: 'no_prompt' });
      await this.post('prompt', who.memberId, who.name, body, today.prompt.id);
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
    const cid = frame.t === 'chat' ? frame.cid : undefined;
    const groupId = this.groupId();
    const found = mediaId !== null && groupId ? await mediaFor(this.env, groupId, mediaId) : null;
    if (mediaId !== null && (found === null || found.memberId !== who.memberId)) {
      return this.sendTo(ws, { t: 'error', code: 'no_media', ...held });
    }
    // A phone re-sending what it was holding is not a second use of the
    // picture — it IS that line, arriving twice, and the cid below drops it
    // silently. Refusing it here would send an `error` frame instead, and an
    // error frame drops the oldest line the outbox is holding.
    const resent = cid !== undefined && this.postedCids.has(cid);
    if (mediaId !== null && !resent && groupId && (await this.alreadyOnALine(groupId, mediaId))) {
      return this.sendTo(ws, { t: 'error', code: 'no_media', ...held });
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
      const posted = this.alreadyPosted(cid);
      if (posted !== null) return this.echo(ws, posted, cid);
    }

    // What he is answering, as a snapshot taken now: an id the room cannot
    // find is dropped quietly and the line still posts, because the words
    // he typed are the thing and the quote is the context.
    const reply = frame.replyTo === undefined ? null : await this.quoteOf(frame.replyTo);

    await this.post('chat', who.memberId, who.name, body, null, media, null, cid, reply);
  }

  /**
   * The line an answer points at, cut down to a quote. The tail first, then
   * the archive: a man may answer something older than five hundred lines.
   * Only what a dad typed is quotable — the room's own lines are facts, and
   * nobody replies to a fact.
   */
  private async quoteOf(id: string): Promise<ReplyTo | null> {
    const cut = (body: string) =>
      [...body].length > REPLY_QUOTE_LENGTH
        ? [...body].slice(0, REPLY_QUOTE_LENGTH - 1).join('') + '…'
        : body;
    const local = this.ctx.storage.sql
      .exec<{ name: string; body: string; kind: string; member_id: string | null }>(
        'SELECT name, body, kind, member_id FROM tail WHERE id = ?',
        id,
      )
      .toArray()[0];
    if (local !== undefined) {
      if (local.member_id === null || (local.kind !== 'chat' && local.kind !== 'prompt'))
        return null;
      return { id, name: local.name, body: cut(local.body) };
    }
    const groupId = this.groupId();
    if (groupId === undefined) return null;
    const row = await this.env.DB.prepare(
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
  private async edit(ws: WebSocket, id: string, memberId: string, raw: string): Promise<void> {
    const body = raw.trim();
    if (!body) return this.sendTo(ws, { t: 'error', code: 'empty' });
    if ([...body].length > MAX_MESSAGE_LENGTH)
      return this.sendTo(ws, { t: 'error', code: 'too_long' });

    const groupId = this.groupId();
    const own = (kind: string | undefined, owner: string | null | undefined) =>
      owner === memberId && (kind === 'chat' || kind === 'prompt');
    let mine = false;
    if (groupId !== undefined) {
      const row = await this.env.DB.prepare(
        'SELECT member_id, kind FROM messages WHERE id = ? AND group_id = ?',
      )
        .bind(id, groupId)
        .first<{ member_id: string | null; kind: string }>();
      if (row !== null) mine = own(row.kind, row.member_id);
    }
    const local = this.ctx.storage.sql
      .exec<{ member_id: string | null; kind: string }>(
        'SELECT member_id, kind FROM tail WHERE id = ?',
        id,
      )
      .toArray()[0];
    if (!mine && local !== undefined) mine = own(local.kind, local.member_id);
    if (!mine) return;

    const editedAt = Date.now();
    this.ctx.storage.sql.exec(
      'UPDATE tail SET body = ?, edited_at = ? WHERE id = ? AND member_id = ?',
      body,
      editedAt,
      id,
      memberId,
    );
    this.broadcast({ t: 'edited', id, body, editedAt, rev: this.noteChange('line', id) });
    if (groupId !== undefined) {
      await this.env.DB.prepare(
        'UPDATE messages SET body = ?, edited_at = ? WHERE id = ? AND group_id = ? AND member_id = ?',
      )
        .bind(body, editedAt, id, groupId, memberId)
        .run()
        .catch((err: unknown) => console.error('edit: archive kept the old words', { id }, err));
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const who = ws.deserializeAttachment() as SocketIdentity | null;
    if (!who) return;
    // The closing socket is still in getWebSockets() until the handshake
    // completes; exclude it explicitly when deciding whether the dad is gone.
    // Whether or not the dad is wholly gone, that socket's microphone is.
    if (who.inCall === true) this.broadcastCallRoster(ws);
    if (this.isPresent(who.memberId, ws)) return;
    await this.scheduleLeave(who);
    this.broadcastRoster(ws);

    // The others were talking to him. Tell them to tear the connection down
    // now rather than leave it to a timeout: he did not press Leave, his
    // phone went into a tunnel, and the mesh should not wait to find out.
    if (who.inCall === true) {
      this.broadcast({ t: 'rtc', from: who.memberId, name: who.name, payload: { hangup: true } });
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  // ----------------------------------------------------------------- alarm

  async alarm(): Promise<void> {
    const now = Date.now();
    const due = this.ctx.storage.sql
      .exec<{ member_id: string; name: string }>(
        'SELECT member_id, name FROM leaving WHERE leave_at <= ?',
        now,
      )
      .toArray();

    for (const row of due) {
      this.ctx.storage.sql.exec('DELETE FROM leaving WHERE member_id = ?', row.member_id);
      // Reconnected during the grace window but the row survived a race: the
      // dad is here, so he did not leave.
      if (this.isPresent(row.member_id)) continue;
      await this.notePresence(row.member_id, row.name, 'out');
    }

    const timers = this.ctx.storage.sql
      .exec<{ kind: string }>('SELECT kind FROM schedule WHERE due_at <= ?', now)
      .toArray();
    for (const timer of timers) {
      this.ctx.storage.sql.exec('DELETE FROM schedule WHERE kind = ?', timer.kind);
      if (timer.kind === 'night_start') await this.openDadNight(now);
      else if (timer.kind === 'night_end') await this.closeDadNight(now);
      else if (timer.kind === 'night_remind') await this.remindOfDadNight();
    }

    this.ensureNightScheduled();
    await this.rescheduleAlarm();
  }

  // ------------------------------------------------------------ dad night

  private storedNight(): DadNight | null {
    const raw = this.ctx.storage.sql
      .exec<{ value: string }>(`SELECT value FROM meta WHERE key = 'night'`)
      .toArray()[0]?.value;
    if (!raw) return null;
    try {
      return JSON.parse(raw) as DadNight;
    } catch {
      return null;
    }
  }

  /**
   * Point the room at a schedule. Re-applying the same one is a no-op, so the
   * every-connection call costs nothing; a genuinely new night throws away the
   * old timers and arms fresh ones.
   */
  private applyNight(night: DadNight | null): void {
    const current = this.storedNight();
    const same = JSON.stringify(current) === JSON.stringify(night);
    if (!same) {
      if (night) {
        this.ctx.storage.sql.exec(
          `INSERT OR REPLACE INTO meta (key, value) VALUES ('night', ?)`,
          JSON.stringify(night),
        );
      } else {
        this.ctx.storage.sql.exec(`DELETE FROM meta WHERE key = 'night'`);
      }
      this.ctx.storage.sql.exec(
        `DELETE FROM schedule WHERE kind IN ('night_start','night_end','night_remind')`,
      );
    }
    this.ensureNightScheduled();
  }

  /** Arm whichever end of the night comes next, if nothing is armed already. */
  private ensureNightScheduled(now = Date.now()): void {
    const night = this.storedNight();
    if (!night || !isValidNight(night)) {
      this.ctx.storage.sql.exec(
        `DELETE FROM schedule WHERE kind IN ('night_start','night_end','night_remind')`,
      );
      return;
    }
    const armed = this.ctx.storage.sql.exec('SELECT 1 FROM schedule').toArray().length;
    if (armed) return;

    // Setting a night mid-evening should not wait a week to mean anything: if
    // we are already inside a window, arm its end.
    const window = currentWindow(night, now);
    if (window) return this.arm('night_end', window.end);
    const start = nextStart(night, now);
    if (start === null) return;
    this.arm('night_start', start);
    // The day before, for the dads who asked to be told. A nudge on Wednesday
    // evening is the one that changes whether a man turns up on Thursday; the
    // one at 21:00 on the night only tells him what he is already missing.
    const remind = start - REMIND_BEFORE_MS;
    if (remind > now) this.arm('night_remind', remind);
  }

  private arm(kind: 'night_start' | 'night_end' | 'night_remind', at: number): void {
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO schedule (kind, due_at) VALUES (?, ?)',
      kind,
      at,
    );
  }

  /**
   * Tomorrow night, to the phones that asked.
   *
   * Nothing is said in the room: a line saying "dad night tomorrow" every
   * single week is the definition of furniture, and the countdown is already
   * on the header for anyone who has the room open. This reaches the man who
   * does not.
   */
  private async remindOfDadNight(): Promise<void> {
    const groupId = this.groupId();
    if (groupId === undefined) return;
    await notifyGroup(this.env, groupId, dadNightReminder());
  }

  private async openDadNight(now: number): Promise<void> {
    const night = this.storedNight();
    // Still counted, and still said — to the phones that asked to be told,
    // which is not the conversation.
    const items = await this.itemsUpForTonight(night, now);

    const window = night ? currentWindow(night, now) : null;
    // If the alarm ran so late that the window already closed, there is
    // nothing to close; ensureNightScheduled arms next week instead.
    //
    // Armed BEFORE the notifications go out, not after: sending them is a
    // fan-out of HTTPS requests to services we do not run, and an alarm that
    // has not been re-armed yet is a summary that never happens because
    // somebody's push service was having a bad evening.
    if (window) this.arm('night_end', window.end);

    // The one thing this app does that reaches a dad who is not looking at
    // it, and only for the dads who asked for it.
    const groupId = this.groupId();
    if (groupId !== undefined) {
      await notifyGroup(this.env, groupId, {
        title: 'dads',
        body: items > 0 ? `The table’s open. ${items} to get into.` : 'The table’s open.',
        tag: 'dad-night',
      });
    }
  }

  /**
   * How many things the week put up for the evening now starting.
   *
   * Counted from D1, like the summary is: the list is written by a route and
   * this object never sees those writes go past.
   */
  private async itemsUpForTonight(night: DadNight | null, now: number): Promise<number> {
    const groupId = this.groupId();
    const start = night ? currentWindow(night, now)?.start : undefined;
    if (groupId === undefined || start === undefined) return 0;
    try {
      const row = await this.env.DB.prepare(
        'SELECT COUNT(*) AS n FROM night_items WHERE group_id = ? AND occurrence = ?',
      )
        .bind(groupId, start)
        .first<{ n: number }>();
      return row?.n ?? 0;
    } catch (err) {
      // A count that cannot be read is not a reason to skip opening the night.
      console.error('night items count failed', err);
      return 0;
    }
  }

  /**
   * The point of the whole feature: the group finds out, in writing, whether
   * it showed up. Counted from the D1 archive rather than the capped tail,
   * because the archive is the record.
   */
  /**
   * The evening's window has closed.
   *
   * It used to count the room — how many turned up, how many lines, what the
   * week had in it — and post the whole thing as one line. The conversation
   * is what the dads typed now, and every number that line carried is on a
   * screen of its own: who came is the night sheet, the week is the week.
   *
   * What survives is the SCHEDULE. The alarm still has to fire, because a
   * night that has been and gone is what makes the next one arrangeable —
   * and a one-off that has used itself up leaves the group with no evening
   * to come, which is what turns home back into the calendar. That happens
   * because the night's date is in the past, not because anybody was told.
   */
  private async closeDadNight(_now: number): Promise<void> {
    return Promise.resolve();
  }

  // -------------------------------------------------------------- presence

  private isPresent(memberId: string, except?: WebSocket): boolean {
    return this.ctx.getWebSockets(memberId).some((ws) => ws !== except);
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
  private roster(except?: WebSocket): RosterEntry[] {
    const seen = new Map<string, RosterEntry>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const who = ws.deserializeAttachment() as SocketIdentity | null;
      if (who && !seen.has(who.memberId)) seen.set(who.memberId, { ...who });
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private broadcastRoster(except?: WebSocket): void {
    this.broadcast({ t: 'roster', roster: this.roster(except) });
  }

  /** Who has a microphone in the room, deduped by dad. Same exclusion, and for
   * the same reason: a dropped dad who stays on the list is a dad everyone
   * else is still holding a dead peer connection to. */
  private callRoster(except?: WebSocket): CallMember[] {
    const seen = new Map<string, CallMember>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const who = ws.deserializeAttachment() as SocketIdentity | null;
      if (who?.inCall === true && !seen.has(who.memberId)) {
        seen.set(who.memberId, {
          memberId: who.memberId,
          name: who.name,
          muted: who.muted === true,
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private broadcastCallRoster(except?: WebSocket): void {
    this.broadcast({ t: 'call-roster', members: this.callRoster(except) });
  }

  /**
   * Whether this picture is already on a line.
   *
   * The archive rather than the tail: an id a client offers can be as old as
   * anything it was handed in a backfill, and the tail holds five hundred
   * lines. One query, and only when a line carries an attachment at all.
   */
  private async alreadyOnALine(groupId: string, mediaId: string): Promise<boolean> {
    const row = await this.env.DB.prepare(
      'SELECT 1 AS n FROM messages WHERE group_id = ? AND media_id = ? LIMIT 1',
    )
      .bind(groupId, mediaId)
      .first<{ n: number }>();
    return row !== null;
  }

  /** Lines already posted, by the sender's own id for them: when, and which
   * line it became. */
  private readonly postedCids = new Map<string, { at: number; id: string }>();

  /** The line a cid already became, or null the first time it is offered. */
  private alreadyPosted(cid: string, now = Date.now()): string | null {
    for (const [seen, { at }] of this.postedCids) {
      if (now - at > CID_MEMORY_MS) this.postedCids.delete(seen);
    }
    return this.postedCids.get(cid)?.id ?? null;
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
  private async echo(ws: WebSocket, id: string, cid: string): Promise<void> {
    const row = this.ctx.storage.sql
      .exec<TailRow>('SELECT * FROM tail WHERE id = ?', id)
      .toArray()[0];
    if (row === undefined) return this.sendTo(ws, { t: 'error', code: 'gone', cid });
    const message = (await this.messagesFrom([row]))[0];
    if (message !== undefined) this.sendTo(ws, { t: 'msg', message, cid });
  }

  private async scheduleLeave(who: SocketIdentity): Promise<void> {
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO leaving (member_id, name, leave_at) VALUES (?, ?, ?)',
      who.memberId,
      who.name,
      Date.now() + LEAVE_GRACE_MS,
    );
    await this.rescheduleAlarm();
  }

  /** @returns whether a leave was pending — i.e. this is a return, not an arrival. */
  private cancelLeave(memberId: string): boolean {
    const pending = this.ctx.storage.sql
      .exec('SELECT 1 FROM leaving WHERE member_id = ?', memberId)
      .toArray().length;
    if (pending) this.ctx.storage.sql.exec('DELETE FROM leaving WHERE member_id = ?', memberId);
    return pending > 0;
  }

  /** One alarm per object: always set it to the earliest thing pending, from
   * either queue. */
  private async rescheduleAlarm(): Promise<void> {
    const next = this.ctx.storage.sql
      .exec<{ at: number | null }>(
        `SELECT MIN(at) AS at FROM (
           SELECT MIN(leave_at) AS at FROM leaving
           UNION ALL
           SELECT MIN(due_at) AS at FROM schedule
         )`,
      )
      .one().at;
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
  }

  // -------------------------------------------------------------- messages

  /**
   * The room, saying something about itself.
   *
   * Both halves go down: the English in `body`, because that is what the
   * archive reads like and what an old client shows, and the fact in `meta`,
   * because that is what lets a dad read it in French.
   */
  /** When each dad was last nudged about his turn. In memory on purpose: an
   * eviction forgetting it costs one extra nudge, and a table keeps its own
   * timers anyway. */
  private turnNudged = new Map<string, number>();

  /** Who won the last game, from D1; null for a group nobody has won in. */
  private async champions(): Promise<Champions | null> {
    const groupId = this.groupId();
    if (groupId === undefined) return null;
    const row = await this.env.DB.prepare('SELECT champions FROM groups WHERE id = ?')
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
   * is dropped. Names are joined the way a turn nudge joins them — as the
   * table knows them, twenty characters — and a winner who is not a dad here
   * (a guest at the table) crowns nobody. A game no human won still ends the
   * last crown: "until the next game ends" is the whole rule.
   *
   * Trusts the frame like the turn nudge does: any dad's socket can send one,
   * and a man who crowns himself by hand has earned it, among five friends.
   */
  private async crown(winners: string[]): Promise<void> {
    const groupId = this.groupId();
    if (groupId === undefined) return;
    try {
      const { results } = await this.env.DB.prepare(
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
      const last = await this.champions();
      if (
        last !== null &&
        now - last.at < CROWN_REPEAT_MS &&
        last.ids.length === ids.length &&
        last.ids.every((id, i) => id === ids[i])
      ) {
        return;
      }
      const champions: Champions | null = ids.length === 0 ? null : { ids, at: now };
      await this.env.DB.prepare('UPDATE groups SET champions = ? WHERE id = ?')
        .bind(champions === null ? null : JSON.stringify(champions), groupId)
        .run();
      this.broadcast({ t: 'champions', champions });
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
  private async nudgeTurn(name: string): Promise<void> {
    const groupId = this.groupId();
    if (groupId === undefined) return;
    const now = Date.now();
    const last = this.turnNudged.get(name) ?? 0;
    if (now - last < TURN_NUDGE_EVERY_MS) return;
    this.turnNudged.set(name, now);
    try {
      // Compared as the table knows the name: jaffre keeps twenty
      // characters, and a longer dads name would otherwise never match.
      const { results } = await this.env.DB.prepare(
        'SELECT id, display_name FROM members WHERE group_id = ?',
      )
        .bind(groupId)
        .all<{ id: string; display_name: string }>();
      for (const member of results.filter((m) => tableName(m.display_name) === name)) {
        await notifyMember(this.env, member.id, {
          title: 'dads',
          body: 'Your turn at the table.',
          tag: 'table-turn',
        });
      }
    } catch (err) {
      console.error('turn nudge failed', { name }, err);
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
  private async retract(id: string, memberId: string): Promise<void> {
    const groupId = this.groupId();
    const own = (kind: string | undefined, owner: string | null | undefined) =>
      owner === memberId && (kind === 'chat' || kind === 'prompt');

    let mediaId: string | null = null;
    let mine = false;

    if (groupId !== undefined) {
      const row = await this.env.DB.prepare(
        'SELECT member_id, media_id, kind FROM messages WHERE id = ? AND group_id = ?',
      )
        .bind(id, groupId)
        .first<{ member_id: string | null; media_id: string | null; kind: string }>();
      if (row !== null) {
        mine = own(row.kind, row.member_id);
        mediaId = row.media_id;
      }
    }

    const local = this.ctx.storage.sql
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
      await this.env.DB.prepare(
        'DELETE FROM messages WHERE id = ? AND group_id = ? AND member_id = ?',
      )
        .bind(id, groupId, memberId)
        .run();
    }
    this.ctx.storage.sql.exec('DELETE FROM tail WHERE id = ? AND member_id = ?', id, memberId);

    // The picture goes with the line it was on. Half the reason for taking a
    // line back is the thing attached to it.
    if (mediaId !== null && groupId !== undefined) {
      await forgetMedia(this.env, groupId, mediaId).catch((err: unknown) => {
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
    await this.unquote(id);

    this.broadcast({ t: 'gone', id, rev: this.noteChange('gone', id) });
  }

  /**
   * Take a line out of the quotes that answer it.
   *
   * Matched on the id INSIDE the stored JSON rather than by holding a list of
   * who quoted whom: a quote is rare, a retraction is rarer, and a second
   * table to keep in step with both is a worse thing to own than one scan.
   */
  private async unquote(id: string): Promise<void> {
    this.ctx.storage.sql.exec(
      "UPDATE tail SET reply = NULL WHERE reply IS NOT NULL AND json_extract(reply, '$.id') = ?",
      id,
    );
    const groupId = this.groupId();
    if (groupId === undefined) return;
    await this.env.DB.prepare(
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
  private async react(id: string, memberId: string, emoji: string, on: boolean): Promise<void> {
    const groupId = this.groupId();
    if (groupId === undefined) return;

    try {
      if (on) {
        // The line has to be this group's. Selecting it into the INSERT is
        // what makes a stray id from another room a no-op rather than a row.
        await this.env.DB.prepare(
          `INSERT OR IGNORE INTO reactions (message_id, member_id, emoji, group_id, created_at)
           SELECT ?1, ?2, ?3, ?4, ?5 FROM messages WHERE id = ?1 AND group_id = ?4`,
        )
          .bind(id, memberId, emoji, groupId, Date.now())
          .run();
      } else {
        await this.env.DB.prepare(
          `DELETE FROM reactions
            WHERE message_id = ? AND member_id = ? AND emoji = ? AND group_id = ?`,
        )
          .bind(id, memberId, emoji, groupId)
          .run();
      }
      const all = await this.reactionsById([id]);
      this.broadcast({
        t: 'reacted',
        id,
        reactions: all.get(id) ?? [],
        rev: this.noteChange('line', id),
      });
    } catch (err) {
      // Nobody is waiting on this and nothing downstream depends on it. A
      // mark that did not land is a mark a man can press again.
      console.error('react failed', { id, emoji }, err);
    }
  }

  /** Marks on a set of lines, oldest first within each. */
  private async reactionsById(ids: string[]): Promise<Map<string, Reaction[]>> {
    const found = new Map<string, Reaction[]>();
    const groupId = this.groupId();
    if (ids.length === 0 || groupId === undefined) return found;

    // Chunked for the same reason the attachments are: D1 takes about a
    // hundred bound parameters and a backfill can carry five hundred lines.
    for (const slice of chunks(ids)) {
      const placeholders = slice.map(() => '?').join(', ');
      const { results } = await this.env.DB.prepare(
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
  private async membersOfGroup(): Promise<RosterEntry[]> {
    const groupId = this.groupId();
    if (groupId === undefined) return [];
    try {
      const { results } = await this.env.DB.prepare(
        'SELECT id, display_name, avatar_at, glasses, glasses_fit FROM members WHERE group_id = ?',
      )
        .bind(groupId)
        .all<{
          id: string;
          display_name: string;
          avatar_at: number | null;
          glasses: string | null;
          glasses_fit: string | null;
        }>();
      return results.map((r) => {
        const fit = storedFit(r.glasses_fit);
        return {
          memberId: r.id,
          name: r.display_name,
          face: r.avatar_at ?? undefined,
          ...(isGlasses(r.glasses) ? { glasses: r.glasses } : {}),
          ...(fit ? { fit } : {}),
        };
      });
    } catch (err) {
      console.error('members failed', err);
      return [];
    }
  }

  /**
   * Write down that something happened to a line (or its picture), and
   * return its `rev` for the frame that says so.
   *
   * Swept here, the only place that adds a row: past CHANGE_MEMORY_MS or
   * CHANGE_MEMORY_ROWS the oldest go — but never the newest, which is what
   * `currentRev` reads, so the count never goes backwards.
   */
  private noteChange(kind: ChangeKind, ref: string): number {
    const now = Date.now();
    const rev = this.ctx.storage.sql
      .exec<{ rev: number }>(
        'INSERT INTO changes (kind, ref, at) VALUES (?, ?, ?) RETURNING rev',
        kind,
        ref,
        now,
      )
      .one().rev;
    this.ctx.storage.sql.exec(
      'DELETE FROM changes WHERE rev < ? AND (at < ? OR rev <= ?)',
      rev,
      now - CHANGE_MEMORY_MS,
      rev - CHANGE_MEMORY_ROWS,
    );
    return rev;
  }

  /** The newest change, or 0 in a room where nothing has changed yet. */
  private currentRev(): number {
    return (
      this.ctx.storage.sql.exec<{ rev: number | null }>('SELECT MAX(rev) AS rev FROM changes').one()
        .rev ?? 0
    );
  }

  /**
   * Whether every change after `since` is still written down. Not if the
   * oldest one kept is past the one after it (swept), and not if `since` is
   * ahead of anything this room has ever numbered (a room that lost its
   * storage, or a number from somewhere else).
   */
  private remembersSince(since: number): boolean {
    const { oldest, newest } = this.ctx.storage.sql
      .exec<{ oldest: number | null; newest: number | null }>(
        'SELECT MIN(rev) AS oldest, MAX(rev) AS newest FROM changes',
      )
      .one();
    if (since > (newest ?? 0)) return false;
    return oldest === null || since >= oldest - 1;
  }

  /**
   * Everything that happened after `since`, as what it is NOW rather than
   * as the steps that got there: a line marked, unmarked and edited is one
   * entry with its current words and marks. Words from the tail, which
   * holds the newest; from the archive for a line older than the tail.
   */
  private async replaySince(since: number): Promise<{
    gone: string[];
    changed: LineState[];
    media: { mediaId: string; kept: boolean | null }[];
  }> {
    const rows = this.ctx.storage.sql
      .exec<{ kind: ChangeKind; ref: string }>(
        'SELECT kind, ref FROM changes WHERE rev > ? ORDER BY rev',
        since,
      )
      .toArray();
    const gone = new Set(rows.filter((r) => r.kind === 'gone').map((r) => r.ref));
    const lineIds = [
      ...new Set(rows.filter((r) => r.kind === 'line' && !gone.has(r.ref)).map((r) => r.ref)),
    ];
    const mediaIds = [...new Set(rows.filter((r) => r.kind === 'media').map((r) => r.ref))];

    const words = new Map<string, { body: string; editedAt: number | null }>();
    for (const id of lineIds) {
      const row = this.ctx.storage.sql
        .exec<{ body: string; edited_at: number | null }>(
          'SELECT body, edited_at FROM tail WHERE id = ?',
          id,
        )
        .toArray()[0];
      if (row !== undefined) words.set(id, { body: row.body, editedAt: row.edited_at });
    }
    const groupId = this.groupId();
    const older = lineIds.filter((id) => !words.has(id));
    // Chunked, like every other `IN (...)` a resume can build: the log keeps
    // thirty days of changes, D1 takes about a hundred bound parameters, and a
    // phone that slept a fortnight while the shelf turned over would otherwise
    // throw here, get no hello, and reconnect with the same `rev` for ever.
    if (older.length > 0 && groupId !== undefined) {
      for (const slice of chunks(older)) {
        const { results } = await this.env.DB.prepare(
          `SELECT id, body, edited_at FROM messages
            WHERE group_id = ? AND id IN (${slice.map(() => '?').join(', ')})`,
        )
          .bind(groupId, ...slice)
          .all<{ id: string; body: string; edited_at: number | null }>();
        for (const r of results) words.set(r.id, { body: r.body, editedAt: r.edited_at });
      }
    }
    const marks = await this.reactionsById(lineIds);
    const changed = lineIds.flatMap((id) => {
      const w = words.get(id);
      return w === undefined ? [] : [{ id, ...w, reactions: marks.get(id) ?? [] }];
    });

    const kept = new Map<string, boolean>();
    if (mediaIds.length > 0 && groupId !== undefined) {
      for (const slice of chunks(mediaIds)) {
        const { results } = await this.env.DB.prepare(
          `SELECT id, kept FROM media
            WHERE group_id = ? AND id IN (${slice.map(() => '?').join(', ')})`,
        )
          .bind(groupId, ...slice)
          .all<{ id: string; kept: number }>();
        for (const r of results) kept.set(r.id, r.kept === 1);
      }
    }
    const media = mediaIds.map((mediaId) => ({ mediaId, kept: kept.get(mediaId) ?? null }));

    return { gone: [...gone], changed, media };
  }

  private async post(
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
    if (cid !== undefined) this.postedCids.set(cid, { at: createdAt, id });

    const meta = said === null ? null : JSON.stringify(said);
    const seq = this.ctx.storage.sql
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
    this.ctx.storage.sql.exec(
      `DELETE FROM tail WHERE seq <= (SELECT MAX(seq) FROM tail) - ?`,
      TAIL_LIMIT,
    );

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
    this.broadcast(cid === undefined ? { t: 'msg', message } : { t: 'msg', message, cid });
    await this.archive(message);
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
  private async notePresence(
    memberId: string | null,
    name: string,
    kind: 'in' | 'out',
  ): Promise<void> {
    const groupId = this.groupId();
    if (!groupId) return;
    try {
      await this.env.DB.prepare(
        `INSERT INTO presence (id, group_id, member_id, name, kind, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(newId('pres'), groupId, memberId, name, kind, Date.now())
        .run();
    } catch (err) {
      // Nobody is waiting on this, and nothing downstream depends on it.
      console.error('presence write failed', { groupId, name, kind }, err);
    }
  }

  private groupId(): string | undefined {
    return this.ctx.storage.sql
      .exec<{ value: string }>(`SELECT value FROM meta WHERE key = 'group_id'`)
      .toArray()[0]?.value;
  }

  private async archive(message: RoomMessage): Promise<void> {
    const groupId = this.groupId();
    if (!groupId) return;
    try {
      await this.env.DB.prepare(
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

  /**
   * Attachments are hydrated from D1 rather than stored in the tail on
   * purpose: the ten-photo cap means a blob can be gone by the time anyone
   * reconnects, and looking it up means that line quietly loses its picture
   * instead of showing a broken one forever.
   */
  private async backfill(after: number | null): Promise<RoomMessage[]> {
    const rows =
      after === null
        ? this.ctx.storage.sql
            .exec<TailRow>('SELECT * FROM tail ORDER BY seq DESC LIMIT ?', FRESH_BACKFILL)
            .toArray()
            .reverse()
        : this.ctx.storage.sql
            .exec<TailRow>('SELECT * FROM tail WHERE seq > ? ORDER BY seq ASC', after)
            .toArray();
    return this.messagesFrom(rows);
  }

  /** Tail rows as the lines a client is handed, attachments and marks on. */
  private async messagesFrom(rows: TailRow[]): Promise<RoomMessage[]> {
    const wanted = [...new Set(rows.map((r) => r.media_id).filter((id) => id !== null))];
    const [attachments, reactions] = await Promise.all([
      this.attachmentsById(wanted),
      // Only what a dad typed can carry a mark, so the room's own lines are
      // not worth asking about.
      this.reactionsById(rows.filter((r) => r.member_id !== null).map((r) => r.id)),
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

  private async attachmentsById(ids: string[]): Promise<Map<string, Attachment>> {
    const found = new Map<string, Attachment>();
    const groupId = this.groupId();
    if (ids.length === 0 || !groupId) return found;

    // D1 allows around a hundred bound parameters per statement, and the tail
    // holds up to 500 rows. Media is capped at ten LIVE per group, but pruned
    // ids stay in tail.media_id forever, so a long-running room can easily
    // carry more distinct ids than that in one backfill. Unchunked, a
    // reconnect would throw, the hello frame would never be built, and that
    // dad would be stuck in a reconnect loop he could not get out of.
    for (const slice of chunks(ids)) {
      const placeholders = slice.map(() => '?').join(', ');
      const { results } = await this.env.DB.prepare(
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

  // ------------------------------------------------------------------ wire

  private sendTo(ws: WebSocket, frame: ServerFrame): void {
    try {
      ws.send(JSON.stringify(frame));
    } catch {
      // A socket mid-close throws on send; webSocketClose will deal with it.
    }
  }

  private broadcast(frame: ServerFrame, except?: WebSocket): void {
    const data = JSON.stringify(frame);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(data);
      } catch {
        // see sendTo
      }
    }
  }
}
