import type { CallMember, ClientFrame } from '../../shared/protocol';
import type { Room, SocketIdentity } from './room';

/** Who has a microphone in the room, deduped by dad. The same exclusion as
 * the roster, and for the same reason: a dropped dad who stays on the list is
 * a dad everyone else is still holding a dead peer connection to. */
export function callRoster(room: Room, except?: WebSocket): CallMember[] {
  const seen = new Map<string, CallMember>();
  for (const ws of room.ctx.getWebSockets()) {
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

export function broadcastCallRoster(room: Room, except?: WebSocket): void {
  room.broadcast({ t: 'call-roster', members: callRoster(room, except) });
}

/** Tell the others to tear down their side of a connection to him, rather
 * than leave them holding one to somebody who has gone. */
export function hangUp(room: Room, who: SocketIdentity, except?: WebSocket): void {
  room.broadcast(
    { t: 'rtc', from: who.memberId, name: who.name, payload: { hangup: true } },
    except,
  );
}

/** He joined the call, left it, or muted. */
export function onCall(
  room: Room,
  ws: WebSocket,
  who: SocketIdentity,
  frame: Extract<ClientFrame, { t: 'call' }>,
): void {
  // The attachment is the only record, so it must be rewritten whole.
  ws.serializeAttachment({
    ...who,
    inCall: frame.join,
    muted: frame.muted === true,
  } satisfies SocketIdentity);
  broadcastCallRoster(room);
  if (!frame.join) hangUp(room, who, ws);
}

/** Relayed verbatim to one dad, with the sender named by the room rather
 * than by the sender: a browser cannot claim to be somebody else. */
export function relayRtc(
  room: Room,
  who: SocketIdentity,
  frame: Extract<ClientFrame, { t: 'rtc' }>,
): void {
  const relayed = JSON.stringify({
    t: 'rtc',
    from: who.memberId,
    name: who.name,
    payload: frame.payload,
  });
  for (const target of room.ctx.getWebSockets(frame.to)) {
    try {
      target.send(relayed);
    } catch {
      // A socket mid-close; webSocketClose will deal with it.
    }
  }
}
