import { DurableObject } from 'cloudflare:workers';
import type { DadNight } from '../shared/dadNight';
import { parseClientFrame, type ServerFrame } from '../shared/protocol';
import type { Env } from './env';
import { broadcastCallRoster, callRoster, hangUp, onCall, relayRtc } from './room/call';
import { currentRev, remembersSince, replaySince } from './room/changes';
import { internalRoute } from './room/internal';
import { backfill, edit, react, retract, say } from './room/lines';
import { membersOfGroup } from './room/members';
import { applyNight, ensureNightScheduled, timersDue } from './room/night';
import {
  broadcastRoster,
  cancelLeave,
  isPresent,
  leaveDue,
  notePresence,
  roster,
  scheduleLeave,
} from './room/presence';
import { IDENTITY_HEADERS, makeRoom, type Room, type SocketIdentity } from './room/room';
import { rescheduleAlarm } from './room/schedule';
import { initStorage } from './room/storage';
import { champions, onTable } from './room/table';

export { IDENTITY_HEADERS };

/**
 * One Durable Object per group. Owns the LIVE half of the room: who is
 * connected, the chat fan-out, typing, the call's signalling, relayed table
 * events and the one alarm. What each of those does lives in `./room/`; this
 * is the object's own surface — the upgrade, the frames, the close and the
 * alarm — and the order things happen in.
 *
 * Identity is never established here. The Worker verified the cookie and
 * forwards it in headers; nothing but the Worker can reach this object.
 */
export class RoomDO extends DurableObject<Env> {
  private readonly room: Room;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.room = makeRoom(ctx, env);
    // Keepalive that never wakes a hibernating object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => initStorage(ctx.storage.sql));
  }

  // ---------------------------------------------------------------- upgrade

  async fetch(request: Request): Promise<Response> {
    const room = this.room;
    const url = new URL(request.url);

    const internal = await internalRoute(room, request, url);
    if (internal !== null) return internal;

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
    room.learnGroup(groupId);

    // Every connection re-states the schedule. Cheap when unchanged, and it
    // means a room whose night was set before it ever had a socket still
    // arms itself the first time someone shows up.
    const nightHeader = request.headers.get(IDENTITY_HEADERS.night);
    applyNight(room, nightHeader ? (JSON.parse(nightHeader) as DadNight) : null);
    await rescheduleAlarm(room);

    const after = Number(url.searchParams.get('after') ?? '');
    const since = Number(url.searchParams.get('rev') ?? '');

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    const wasPresent = isPresent(room, memberId);
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
      remembersSince(room, since);
    const members = await membersOfGroup(room);
    const replay = resuming ? await replaySince(room, since) : null;
    const hello: ServerFrame = {
      t: 'hello',
      you: { memberId, name },
      roster: roster(room),
      call: callRoster(room),
      members,
      messages: await backfill(room, resuming ? after : null),
      rev: currentRev(room),
      fresh: !resuming,
      gone: replay?.gone ?? [],
      changed: replay?.changed ?? [],
      media: replay?.media ?? [],
      champions: await champions(room),
    };
    server.send(JSON.stringify(hello));

    if (!wasPresent) {
      const wasLeaving = cancelLeave(room, memberId);
      // A dad back within the grace window never left, as far as the room is
      // concerned; only a genuine arrival gets a line. His pending alarm goes
      // with the row, so the object is not woken for nothing.
      if (wasLeaving) await rescheduleAlarm(room);
      else await notePresence(room, memberId, name, 'in');
      broadcastRoster(room);
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
      room.broadcast({
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
    const room = this.room;
    const who = ws.deserializeAttachment() as SocketIdentity | null;
    if (!who) return;

    const frame = parseClientFrame(raw);
    if (!frame) return room.sendTo(ws, { t: 'error', code: 'bad_frame' });

    switch (frame.t) {
      case 'typing':
        return room.broadcast({ t: 'typing', memberId: who.memberId, name: who.name }, ws);
      case 'call':
        return onCall(room, ws, who, frame);
      case 'rtc':
        return relayRtc(room, who, frame);
      case 'table':
        return onTable(room, frame);
      case 'retract':
        return retract(room, frame.id, who.memberId);
      case 'react':
        return react(room, frame.id, who.memberId, frame.emoji, frame.on);
      case 'edit':
        return edit(room, ws, frame.id, who.memberId, frame.body);
      case 'chat':
      case 'prompt':
        return say(room, ws, who, frame);
      default: {
        // A new kind of frame has to be handled here, not fall through.
        const unhandled: never = frame;
        return unhandled;
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const room = this.room;
    const who = ws.deserializeAttachment() as SocketIdentity | null;
    if (!who) return;
    // The closing socket is still in getWebSockets() until the handshake
    // completes; exclude it explicitly when deciding whether the dad is gone.
    // Whether or not the dad is wholly gone, that socket's microphone is.
    if (who.inCall === true) broadcastCallRoster(room, ws);
    if (isPresent(room, who.memberId, ws)) return;
    await scheduleLeave(room, who);
    broadcastRoster(room, ws);

    // The others were talking to him. Tell them to tear the connection down
    // now rather than leave it to a timeout: he did not press Leave, his
    // phone went into a tunnel, and the mesh should not wait to find out.
    if (who.inCall === true) hangUp(room, who);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  // ----------------------------------------------------------------- alarm

  async alarm(): Promise<void> {
    const room = this.room;
    const now = Date.now();
    await leaveDue(room, now);
    await timersDue(room, now);
    ensureNightScheduled(room);
    await rescheduleAlarm(room);
  }
}
