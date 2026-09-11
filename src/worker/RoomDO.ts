import { DurableObject } from 'cloudflare:workers';
import {
  currentWindow,
  isValidNight,
  nextStart,
  NIGHT_DURATION_MS,
  previousStart,
  type DadNight,
} from '../shared/dadNight';
import {
  MAX_MESSAGE_LENGTH,
  type Attachment,
  parseClientFrame,
  type CallMember,
  type RoomMessage,
  type RoomsOpen,
  type Reaction,
  type RosterEntry,
  type ServerFrame,
} from '../shared/protocol';
import { tableSaid } from '../shared/jaffre';
import { englishOf, parseSaid, type Said } from '../shared/said';
import { notifyGroup, notifyMember } from './push';
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

/**
 * Every dad with the table open relays the same jaffre event, so "a game
 * started" would arrive once per framed browser. The room keeps the last
 * table line and drops an identical one that follows close behind.
 */
const TABLE_DEDUPE_MS = 20_000;
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
 * How long the room remembers that a line was taken back.
 *
 * Only for the socket that reconnects WITHOUT reloading — it resumes from its
 * last seq and would otherwise keep a line everyone else has lost. A reload
 * needs nothing: the line is out of the tail, so a fresh backfill cannot
 * mention it. A day is far longer than any dead spot.
 */
const RETRACTED_MEMORY_MS = 24 * 60 * 60 * 1000;

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
        -- Lines taken back, so a socket that reconnects without reloading is
        -- told about the ones it missed. A reload needs none of this: the
        -- line is gone from the tail, so a fresh backfill never mentions it.
        -- Swept in retract(), because that is the only thing that adds a row.
        CREATE TABLE IF NOT EXISTS retracted (
          id TEXT PRIMARY KEY,
          at INTEGER NOT NULL
        );
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
      const { night, byName } = (await request.json()) as {
        night: DadNight | null;
        byName: string;
      };
      this.applyNight(night);
      this.broadcast({ t: 'night', night });
      await this.say(byName, nightChange(byName, night));
      await this.rescheduleAlarm();
      return new Response(null, { status: 204 });
    }

    // What the group has open changed. Nothing is said in the conversation —
    // a switch is not news — but every open room finds out at once.
    if (url.pathname === '/rooms' && request.method === 'POST') {
      const rooms = (await request.json()) as RoomsOpen;
      this.broadcast({ t: 'rooms', rooms });
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
      const { groupId, memberId, name, face, was } = (await request.json()) as {
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
      // A name changing with nothing said is four men wondering who the new
      // bloke is. A face changing is not news.
      if (typeof was === 'string' && was !== '' && was !== name) {
        await this.say(name, { k: 'renamed', was, now: name });
      }
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

    // Something happened outside the socket that the room should know about:
    // a check-in, a commitment, how last week went. Only the Worker can reach
    // this. The board is where the detail lives; this is what makes anyone
    // look at the board.
    if (url.pathname === '/announce' && request.method === 'POST') {
      const { name, said } = (await request.json()) as { name: string; said: unknown };
      const parsed = parseSaid(typeof said === 'string' ? said : JSON.stringify(said));
      if (parsed === null) return new Response('bad said', { status: 400 });
      await this.say(name, parsed);
      return new Response(null, { status: 204 });
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

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    const wasPresent = this.isPresent(memberId);
    this.ctx.acceptWebSocket(server, [memberId]);
    const faceHeader = Number(request.headers.get(IDENTITY_HEADERS.face) ?? '');
    const face = Number.isFinite(faceHeader) && faceHeader > 0 ? faceHeader : undefined;
    server.serializeAttachment({ memberId, name, face } satisfies SocketIdentity);

    const resuming = Number.isFinite(after) && after > 0;
    const hello: ServerFrame = {
      t: 'hello',
      you: { memberId, name },
      roster: this.roster(),
      call: this.callRoster(),
      messages: await this.backfill(resuming ? after : null),
      // Only for a resume. A fresh load is backfilled from a tail the line is
      // already out of, so there is nothing on that screen to take back.
      gone: resuming ? this.retractedSince() : [],
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
      const said = tableSaid(frame.event);
      // Every framed dad relays the same event, so the room drops one it has
      // just printed. Compared on the English, which is what the tail holds
      // whatever anyone is reading.
      if (said && !this.recentlySaid(englishOf(said))) {
        await this.say(who.name, said, 'table');
      }
      // His turn has sat for twenty seconds: the one line of this that goes
      // to a phone, and only to his.
      if (frame.event.t === 'turn') await this.nudgeTurn(frame.event.name);
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

    const body = frame.body.trim();
    // An attachment is a message in its own right: a photo with no caption is
    // still something said.
    const mediaId = frame.t === 'chat' ? (frame.mediaId ?? null) : null;
    if (!body && mediaId === null) return this.sendTo(ws, { t: 'error', code: 'empty' });
    if ([...body].length > MAX_MESSAGE_LENGTH)
      return this.sendTo(ws, { t: 'error', code: 'too_long' });

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
    const groupId = this.groupId();
    const found = mediaId !== null && groupId ? await mediaFor(this.env, groupId, mediaId) : null;
    if (mediaId !== null && found === null) {
      return this.sendTo(ws, { t: 'error', code: 'no_media' });
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
          };

    // A dad whose phone lost the signal re-sends what it was holding. If the
    // room got it the first time, the second copy is the same line and not a
    // second thing said.
    const cid = frame.t === 'chat' ? frame.cid : undefined;
    if (cid !== undefined && !this.firstTimeSeen(cid)) return;

    await this.post('chat', who.memberId, who.name, body, null, media, null, cid);
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
    await notifyGroup(this.env, groupId, {
      title: 'dads',
      body: 'Dad night tomorrow. Coming?',
      tag: 'dad-night-soon',
    });
  }

  private async openDadNight(now: number): Promise<void> {
    const night = this.storedNight();
    const items = await this.itemsUpForTonight(night, now);
    await this.say('dad night', items > 0 ? { k: 'night_open', items } : { k: 'night_open' });

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
  private async closeDadNight(now: number): Promise<void> {
    const night = this.storedNight();
    const start = night ? previousStart(night, now) : null;
    if (start === null) return;

    const groupId = this.groupId();
    if (!groupId) return;

    let dads = 0;
    let lines = 0;
    try {
      const row = await this.env.DB.prepare(
        `SELECT COUNT(*) AS lines, COUNT(DISTINCT member_id) AS dads
           FROM messages
          WHERE group_id = ? AND kind = 'chat' AND created_at >= ? AND created_at < ?`,
      )
        .bind(groupId, start, start + NIGHT_DURATION_MS)
        .first<{ lines: number; dads: number }>();
      dads = row?.dads ?? 0;
      lines = row?.lines ?? 0;
    } catch (err) {
      console.error('dad night summary failed', { groupId }, err);
      return;
    }

    await this.say('dad night', { k: 'night_done', dads, lines });
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

  /** Lines already posted, by the sender's own id for them. */
  private readonly postedCids = new Map<string, number>();

  /** True the first time a cid is offered, false for a repeat of one we have
   * already posted. */
  private firstTimeSeen(cid: string, now = Date.now()): boolean {
    for (const [seen, at] of this.postedCids) {
      if (now - at > CID_MEMORY_MS) this.postedCids.delete(seen);
    }
    if (this.postedCids.has(cid)) return false;
    this.postedCids.set(cid, now);
    return true;
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
      const { results } = await this.env.DB.prepare(
        'SELECT id FROM members WHERE group_id = ? AND display_name = ?',
      )
        .bind(groupId, name)
        .all<{ id: string }>();
      for (const member of results) {
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

    const now = Date.now();
    this.ctx.storage.sql.exec('DELETE FROM retracted WHERE at < ?', now - RETRACTED_MEMORY_MS);
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO retracted (id, at) VALUES (?, ?)', id, now);

    this.broadcast({ t: 'gone', id });
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
      this.broadcast({ t: 'reacted', id, reactions: all.get(id) ?? [] });
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
    const CHUNK = 80;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
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

  /** Everything taken back recently, for a socket resuming where it left off. */
  private retractedSince(): string[] {
    return this.ctx.storage.sql
      .exec<{ id: string }>(
        'SELECT id FROM retracted WHERE at >= ?',
        Date.now() - RETRACTED_MEMORY_MS,
      )
      .toArray()
      .map((r) => r.id);
  }

  private async say(name: string, said: Said, kind: 'system' | 'table' = 'system'): Promise<void> {
    await this.post(kind, null, name, englishOf(said), null, null, said);
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
  ): Promise<void> {
    const id = newId('msg');
    const createdAt = Date.now();

    const meta = said === null ? null : JSON.stringify(said);
    const seq = this.ctx.storage.sql
      .exec<{ seq: number }>(
        `INSERT INTO tail (id, kind, member_id, name, body, created_at, prompt_id, media_id, meta)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING seq`,
        id,
        kind,
        memberId,
        name,
        body,
        createdAt,
        promptId,
        media?.id ?? null,
        meta,
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

  /** Has this exact line already gone out in the last few seconds? */
  private recentlySaid(body: string): boolean {
    const row = this.ctx.storage.sql
      .exec<{ created_at: number }>(
        `SELECT created_at FROM tail WHERE kind = 'table' AND body = ?
          ORDER BY seq DESC LIMIT 1`,
        body,
      )
      .toArray()[0];
    return row !== undefined && Date.now() - row.created_at < TABLE_DEDUPE_MS;
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
           (id, group_id, member_id, kind, body, created_at, prompt_id, media_id, meta)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    const CHUNK = 80;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const placeholders = slice.map(() => '?').join(', ');
      const { results } = await this.env.DB.prepare(
        `SELECT id, name, content_type, width, height FROM media
          WHERE group_id = ? AND id IN (${placeholders})`,
      )
        .bind(groupId, ...slice)
        .all<{
          id: string;
          name: string;
          content_type: string;
          width: number | null;
          height: number | null;
        }>();

      for (const row of results) {
        found.set(row.id, {
          id: row.id,
          name: row.name,
          contentType: row.content_type,
          width: row.width,
          height: row.height,
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

function nightChange(byName: string, night: DadNight | null): Said {
  return night
    ? { k: 'night_set', by: byName, weekday: night.weekday, time: night.time }
    : { k: 'night_cleared', by: byName };
}
