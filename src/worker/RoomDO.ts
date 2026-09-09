import { DurableObject } from 'cloudflare:workers';
import {
  MAX_MESSAGE_LENGTH,
  parseClientFrame,
  type RoomMessage,
  type RosterEntry,
  type ServerFrame,
} from '../shared/protocol';
import type { Env } from './env';
import { newId } from './identity';

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

interface Attachment {
  memberId: string;
  name: string;
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
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS leaving (
          member_id TEXT PRIMARY KEY,
          name      TEXT NOT NULL,
          leave_at  INTEGER NOT NULL
        );
      `);
    });
  }

  // ---------------------------------------------------------------- upgrade

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ ok: true, id: this.ctx.id.toString() });
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

    const after = Number(url.searchParams.get('after') ?? '');

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    const wasPresent = this.isPresent(memberId);
    this.ctx.acceptWebSocket(server, [memberId]);
    server.serializeAttachment({ memberId, name } satisfies Attachment);

    const hello: ServerFrame = {
      t: 'hello',
      you: { memberId, name },
      roster: this.roster(),
      messages: this.backfill(Number.isFinite(after) && after > 0 ? after : null),
    };
    server.send(JSON.stringify(hello));

    if (!wasPresent) {
      const wasLeaving = this.cancelLeave(memberId);
      // A dad back within the grace window never left, as far as the room is
      // concerned; only a genuine arrival gets a line. His pending alarm goes
      // with the row, so the object is not woken for nothing.
      if (wasLeaving) await this.rescheduleAlarm();
      else await this.post('system', null, name, `${name} came in`);
      this.broadcastRoster();
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // --------------------------------------------------------------- sockets

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const who = ws.deserializeAttachment() as Attachment | null;
    if (!who) return;

    const frame = parseClientFrame(raw);
    if (!frame) return this.sendTo(ws, { t: 'error', code: 'bad_frame' });

    if (frame.t === 'typing') {
      this.broadcast({ t: 'typing', memberId: who.memberId, name: who.name }, ws);
      return;
    }

    const body = frame.body.trim();
    if (!body) return this.sendTo(ws, { t: 'error', code: 'empty' });
    if ([...body].length > MAX_MESSAGE_LENGTH)
      return this.sendTo(ws, { t: 'error', code: 'too_long' });

    await this.post('chat', who.memberId, who.name, body);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const who = ws.deserializeAttachment() as Attachment | null;
    if (!who) return;
    // The closing socket is still in getWebSockets() until the handshake
    // completes; exclude it explicitly when deciding whether the dad is gone.
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
      await this.post('system', null, row.name, `${row.name} left`);
    }
    await this.rescheduleAlarm();
  }

  // -------------------------------------------------------------- presence

  private isPresent(memberId: string, except?: WebSocket): boolean {
    return this.ctx.getWebSockets(memberId).some((ws) => ws !== except);
  }

  private roster(): RosterEntry[] {
    const seen = new Map<string, RosterEntry>();
    for (const ws of this.ctx.getWebSockets()) {
      const who = ws.deserializeAttachment() as Attachment | null;
      if (who && !seen.has(who.memberId)) seen.set(who.memberId, { ...who });
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private broadcastRoster(): void {
    this.broadcast({ t: 'roster', roster: this.roster() });
  }

  private async scheduleLeave(who: Attachment): Promise<void> {
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

  /** One alarm per object: always set it to the earliest pending leave. */
  private async rescheduleAlarm(): Promise<void> {
    const next = this.ctx.storage.sql
      .exec<{ at: number | null }>('SELECT MIN(leave_at) AS at FROM leaving')
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
  ): Promise<void> {
    const id = newId('msg');
    const createdAt = Date.now();

    const seq = this.ctx.storage.sql
      .exec<{ seq: number }>(
        `INSERT INTO tail (id, kind, member_id, name, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING seq`,
        id,
        kind,
        memberId,
        name,
        body,
        createdAt,
      )
      .one().seq;
    this.ctx.storage.sql.exec(
      `DELETE FROM tail WHERE seq <= (SELECT MAX(seq) FROM tail) - ?`,
      TAIL_LIMIT,
    );

    const message: RoomMessage = { seq, id, kind, memberId, name, body, createdAt };
    // Fan out before the archive write: a dad should not wait on D1 to see
    // his own line appear.
    this.broadcast({ t: 'msg', message });
    await this.archive(message);
  }

  private async archive(message: RoomMessage): Promise<void> {
    const groupId = this.ctx.storage.sql
      .exec<{ value: string }>(`SELECT value FROM meta WHERE key = 'group_id'`)
      .toArray()[0]?.value;
    if (!groupId) return;
    try {
      await this.env.DB.prepare(
        `INSERT INTO messages (id, group_id, member_id, kind, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(message.id, groupId, message.memberId, message.kind, message.body, message.createdAt)
        .run();
    } catch (err) {
      // The line already reached every dad and is in the tail. Losing the
      // archive row is a real problem, but not one to surface as a failed
      // send; it is logged so it can be seen.
      console.error('archive failed', { messageId: message.id, groupId }, err);
    }
  }

  private backfill(after: number | null): RoomMessage[] {
    const rows =
      after === null
        ? this.ctx.storage.sql
            .exec<TailRow>('SELECT * FROM tail ORDER BY seq DESC LIMIT ?', FRESH_BACKFILL)
            .toArray()
            .reverse()
        : this.ctx.storage.sql
            .exec<TailRow>('SELECT * FROM tail WHERE seq > ? ORDER BY seq ASC', after)
            .toArray();
    return rows.map((r) => ({
      seq: r.seq,
      id: r.id,
      kind: r.kind,
      memberId: r.member_id,
      name: r.name,
      body: r.body,
      createdAt: r.created_at,
    }));
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
