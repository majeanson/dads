import { DurableObject } from 'cloudflare:workers';
import {
  currentWindow,
  isValidNight,
  nextStart,
  NIGHT_DURATION_MS,
  previousStart,
  WEEKDAY_NAMES,
  type DadNight,
} from '../shared/dadNight';
import {
  MAX_MESSAGE_LENGTH,
  type Attachment,
  parseClientFrame,
  type RoomMessage,
  type RosterEntry,
  type ServerFrame,
} from '../shared/protocol';
import { describeTableEvent } from '../shared/jaffre';
import type { Env } from './env';
import { newId } from './identity';
import { mediaFor } from './media';
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

/** What a live socket remembers about who is on the other end of it. Named
 * for its job rather than for serializeAttachment, so it does not collide
 * with a message's Attachment. */
interface SocketIdentity {
  memberId: string;
  name: string;
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
          media_id   TEXT
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
      await this.post('system', null, byName, describeNightChange(byName, night));
      await this.rescheduleAlarm();
      return new Response(null, { status: 204 });
    }

    // Something happened outside the socket that the room should know about:
    // a check-in, a commitment, how last week went. Only the Worker can reach
    // this. The board is where the detail lives; this is what makes anyone
    // look at the board.
    if (url.pathname === '/announce' && request.method === 'POST') {
      const { name, body } = (await request.json()) as { name: string; body: string };
      await this.post('system', null, name, body);
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
    server.serializeAttachment({ memberId, name } satisfies SocketIdentity);

    const hello: ServerFrame = {
      t: 'hello',
      you: { memberId, name },
      roster: this.roster(),
      call: this.callRoster(),
      messages: await this.backfill(Number.isFinite(after) && after > 0 ? after : null),
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
      ws.serializeAttachment({ ...who, inCall: frame.join } satisfies SocketIdentity);
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
      const line = describeTableEvent(frame.event);
      if (line && !this.recentlySaid(line)) {
        await this.post('table', null, who.name, line);
      }
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

    await this.post('chat', who.memberId, who.name, body, null, media);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const who = ws.deserializeAttachment() as SocketIdentity | null;
    if (!who) return;
    // The closing socket is still in getWebSockets() until the handshake
    // completes; exclude it explicitly when deciding whether the dad is gone.
    // Whether or not the dad is wholly gone, that socket's microphone is.
    if (who.inCall === true) this.broadcastCallRoster();
    if (this.isPresent(who.memberId, ws)) return;
    await this.scheduleLeave(who);
    this.broadcastRoster();
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
      this.ctx.storage.sql.exec(`DELETE FROM schedule WHERE kind IN ('night_start','night_end')`);
    }
    this.ensureNightScheduled();
  }

  /** Arm whichever end of the night comes next, if nothing is armed already. */
  private ensureNightScheduled(now = Date.now()): void {
    const night = this.storedNight();
    if (!night || !isValidNight(night)) {
      this.ctx.storage.sql.exec(`DELETE FROM schedule WHERE kind IN ('night_start','night_end')`);
      return;
    }
    const armed = this.ctx.storage.sql.exec('SELECT 1 FROM schedule').toArray().length;
    if (armed) return;

    // Setting a night mid-evening should not wait a week to mean anything: if
    // we are already inside a window, arm its end.
    const window = currentWindow(night, now);
    if (window) return this.arm('night_end', window.end);
    const start = nextStart(night, now);
    if (start !== null) this.arm('night_start', start);
  }

  private arm(kind: 'night_start' | 'night_end', at: number): void {
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO schedule (kind, due_at) VALUES (?, ?)',
      kind,
      at,
    );
  }

  private async openDadNight(now: number): Promise<void> {
    await this.post('system', null, 'dad night', "Dad night. The table's open.");
    const night = this.storedNight();
    const window = night ? currentWindow(night, now) : null;
    // If the alarm ran so late that the window already closed, there is
    // nothing to close; ensureNightScheduled arms next week instead.
    if (window) this.arm('night_end', window.end);
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

    const body =
      dads === 0
        ? 'Dad night done. Nobody made it this week.'
        : `Dad night done — ${dads} dad${dads === 1 ? '' : 's'}, ${lines} line${lines === 1 ? '' : 's'}.`;
    await this.post('system', null, 'dad night', body);
  }

  // -------------------------------------------------------------- presence

  private isPresent(memberId: string, except?: WebSocket): boolean {
    return this.ctx.getWebSockets(memberId).some((ws) => ws !== except);
  }

  private roster(): RosterEntry[] {
    const seen = new Map<string, RosterEntry>();
    for (const ws of this.ctx.getWebSockets()) {
      const who = ws.deserializeAttachment() as SocketIdentity | null;
      if (who && !seen.has(who.memberId)) seen.set(who.memberId, { ...who });
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private broadcastRoster(): void {
    this.broadcast({ t: 'roster', roster: this.roster() });
  }

  /** Who has a microphone in the room, deduped by dad. */
  private callRoster(): RosterEntry[] {
    const seen = new Map<string, RosterEntry>();
    for (const ws of this.ctx.getWebSockets()) {
      const who = ws.deserializeAttachment() as SocketIdentity | null;
      if (who?.inCall === true && !seen.has(who.memberId)) {
        seen.set(who.memberId, { memberId: who.memberId, name: who.name });
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private broadcastCallRoster(): void {
    this.broadcast({ t: 'call-roster', members: this.callRoster() });
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

  private async post(
    kind: RoomMessage['kind'],
    memberId: string | null,
    name: string,
    body: string,
    promptId: string | null = null,
    media: Attachment | null = null,
  ): Promise<void> {
    const id = newId('msg');
    const createdAt = Date.now();

    const seq = this.ctx.storage.sql
      .exec<{ seq: number }>(
        `INSERT INTO tail (id, kind, member_id, name, body, created_at, prompt_id, media_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING seq`,
        id,
        kind,
        memberId,
        name,
        body,
        createdAt,
        promptId,
        media?.id ?? null,
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
    };
    // Fan out before the archive write: a dad should not wait on D1 to see
    // his own line appear.
    this.broadcast({ t: 'msg', message });
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
        `INSERT INTO messages (id, group_id, member_id, kind, body, created_at, prompt_id, media_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
    const attachments = await this.attachmentsById(wanted);

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

function describeNightChange(byName: string, night: DadNight | null): string {
  return night
    ? `${byName} set dad night to ${WEEKDAY_NAMES[night.weekday]}s at ${night.time}.`
    : `${byName} cleared dad night.`;
}
