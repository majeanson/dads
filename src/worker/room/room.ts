import type { ServerFrame } from '../../shared/protocol';
import type { Env } from '../env';

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

/** What a live socket remembers about who is on the other end of it. Named
 * for its job rather than for serializeAttachment, so it does not collide
 * with a message's Attachment. */
export interface SocketIdentity {
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

/**
 * What the object remembers only while it is awake.
 *
 * On the object, never at module scope: several objects of one class can
 * share an isolate, and a map at module scope would be every group's at once.
 */
export interface RoomMemory {
  /** Lines already posted, by the sender's own id for them: when, and which
   * line it became. */
  readonly postedCids: Map<string, { at: number; id: string }>;
  /** When each dad was last nudged about his turn. In memory on purpose: an
   * eviction forgetting it costs one extra nudge, and a table keeps its own
   * timers anyway. */
  readonly turnNudged: Map<string, number>;
  /**
   * The last game-over this object crowned from, by the winners' names.
   *
   * Every framed dad relays the same game-over a few hundred milliseconds
   * apart, and the check against the stored crown sits behind two D1 round
   * trips — during which the object takes the next relay, which reads the
   * same old crown and crowns again. Claimed here, before the first await,
   * the check-and-claim is one step nothing can come between. The stored
   * crown still answers for an object that was evicted in between.
   */
  crownClaim: { key: string; at: number } | null;
}

/**
 * The one group's room, as every part of it sees it: the object's storage,
 * the Worker's bindings, and the sockets. `RoomDO` builds one of these and
 * hands it to the modules in this folder, which never reach the object
 * itself.
 */
export interface Room {
  readonly env: Env;
  readonly ctx: DurableObjectState;
  readonly sql: SqlStorage;
  readonly memory: RoomMemory;
  /** The group this object is, once a socket or the Worker has said so. */
  groupId(): string | undefined;
  /** Remember the group, the first time anything names it. */
  learnGroup(groupId: string): void;
  sendTo(ws: WebSocket, frame: ServerFrame): void;
  broadcast(frame: ServerFrame, except?: WebSocket): void;
}

export function makeRoom(ctx: DurableObjectState, env: Env): Room {
  const sql = ctx.storage.sql;
  return {
    env,
    ctx,
    sql,
    memory: { postedCids: new Map(), turnNudged: new Map(), crownClaim: null },
    groupId() {
      return sql
        .exec<{ value: string }>(`SELECT value FROM meta WHERE key = 'group_id'`)
        .toArray()[0]?.value;
    },
    learnGroup(groupId) {
      sql.exec(`INSERT OR REPLACE INTO meta (key, value) VALUES ('group_id', ?)`, groupId);
    },
    sendTo(ws, frame) {
      try {
        ws.send(JSON.stringify(frame));
      } catch {
        // A socket mid-close throws on send; webSocketClose will deal with it.
      }
    },
    broadcast(frame, except) {
      const data = JSON.stringify(frame);
      for (const ws of ctx.getWebSockets()) {
        if (ws === except) continue;
        try {
          ws.send(data);
        } catch {
          // see sendTo
        }
      }
    },
  };
}
