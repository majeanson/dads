import { useCallback, useEffect, useRef, useState } from 'react';
import type { DadNight } from '../shared/dadNight';
import type { CallMember, RoomsOpen } from '../shared/protocol';
import type { TableEvent } from '../shared/jaffre';
import type { RoomMessage, RosterEntry, ServerFrame } from '../shared/protocol';

export type Connection = 'connecting' | 'open' | 'reconnecting';

export interface RoomState {
  connection: Connection;
  you: RosterEntry | null;
  roster: RosterEntry[];
  messages: RoomMessage[];
  /** memberId → name, of dads typing in the last few seconds. */
  typing: Map<string, string>;
  /** Who has a microphone in the room. Being here and being on the call are
   * different things. */
  call: CallMember[];
  /** Seeded from the session, then kept current by `night` frames, so a dad
   * who changes it updates every open room without a reload. */
  night: DadNight | null;
  /** The same, for what the group has open. */
  rooms: RoomsOpen;
  /** Lines typed while the socket was down, waiting to go. */
  waiting: number;
}

/**
 * How many unsent lines are held while the socket is down.
 *
 * A phone in a lift is back in a minute; a phone left in a drawer overnight is
 * a different thing, and neither of them should be able to grow this without
 * bound. Twenty is more than anybody types into a dead socket before noticing.
 */
const OUTBOX_LIMIT = 20;

const PING_INTERVAL_MS = 30_000;

/**
 * How long a socket may say nothing before we stop believing in it.
 *
 * The hard case is not the socket that closes — that one announces itself and
 * reconnects. It is the one a phone leaves behind when the signal goes: it
 * stays readyState OPEN, every send is swallowed, and nothing ever fires. The
 * server answers every ping with a pong, so silence across two pings means
 * this end is talking to nobody.
 */
const SILENCE_MS = 2.5 * PING_INTERVAL_MS;

/** How often the two checks below run. */
const WATCH_INTERVAL_MS = 3_000;

/**
 * How long a line may sit unanswered before we stop believing the socket.
 *
 * The room echoes every line back to the man who sent it, so an unanswered one
 * after this long means the send went nowhere. Short, because he is watching
 * the screen: waiting out a 30-second ping to find out is waiting too long.
 */
const ACK_GRACE_MS = 8_000;

/** After this many goes, a line is not going to be accepted — a body the room
 * refuses would otherwise be re-sent for the rest of the evening. */
const MAX_TRIES = 3;
const TYPING_TTL_MS = 4_000;
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 15_000;

/**
 * One socket to the group's room. Reconnects with backoff and asks only for
 * what it missed (`after=<last seq>`), so a phone that hopped networks sees
 * the three lines it lost, not the whole evening again.
 */
export function useRoom(enabled: boolean, initialNight: DadNight | null, initialRooms: RoomsOpen) {
  /** Set by the call, read by the socket. A ref so a new peer never rebuilds
   * the connection. */
  const onSignalRef = useRef<(from: string, name: string, payload: unknown) => void>(() => {});
  const [state, setState] = useState<RoomState>({
    connection: 'connecting',
    you: null,
    roster: [],
    messages: [],
    typing: new Map(),
    call: [],
    night: initialNight,
    rooms: initialRooms,
    waiting: 0,
  });

  const socket = useRef<WebSocket | null>(null);
  const lastSeq = useRef(0);
  const attempt = useRef(0);
  const typingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /**
   * What was said while there was nothing to say it down.
   *
   * A man on a platform types a line, presses send, and the app takes it — the
   * socket being closed is the app's problem, not his. Held in memory and not
   * in storage on purpose: this covers a signal that comes back, and a queue
   * that outlives the tab is a line posted an hour later out of nowhere, or
   * posted twice.
   */
  const outbox = useRef<
    { cid: string; body: string; mediaId?: string; sentAt?: number; tries: number }[]
  >([]);
  /** Anything at all from the server, pong included. */
  const lastHeard = useRef(0);
  const closedByUs = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    closedByUs.current = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const after = lastSeq.current > 0 ? `?after=${lastSeq.current}` : '';
      const ws = new WebSocket(`${proto}//${location.host}/ws${after}`);
      socket.current = ws;

      ws.onopen = () => {
        attempt.current = 0;
        lastHeard.current = Date.now();
        // Still held, not cleared: a line is delivered when it comes back with
        // its own id, and not before. Re-sending one the room already has is
        // what the cid is for at the other end. In the order he typed them.
        for (const line of outbox.current) sendLine(ws, line);

        let lastPing = Date.now();
        pingTimer = setInterval(() => {
          // Guarded like every other send here: the socket can enter CLOSING
          // between the tick and the send, and an unhandled throw in a timer
          // is a hard error rather than a dropped keepalive.
          if (ws.readyState !== WebSocket.OPEN) return;
          const now = Date.now();

          // A line that has not come back. The socket says OPEN and is
          // delivering nothing, which is exactly what a phone in a dead spot
          // leaves behind. Close it and let the reconnect carry the outbox.
          const stuck = outbox.current.find(
            (l) => l.sentAt !== undefined && now - l.sentAt > ACK_GRACE_MS,
          );
          if (stuck) {
            if (stuck.tries >= MAX_TRIES) {
              // The room is not going to take this one. Dropping it beats
              // re-sending it for the rest of the evening.
              outbox.current = outbox.current.filter((l) => l !== stuck);
              setState((st) => ({ ...st, waiting: outbox.current.length }));
              return;
            }
            return ws.close();
          }

          // And a socket that has said nothing at all, for a dad who is only
          // reading: the room answers every ping, so silence is an answer.
          if (now - lastHeard.current > SILENCE_MS) return ws.close();
          if (now - lastPing >= PING_INTERVAL_MS) {
            lastPing = now;
            ws.send('ping');
          }
        }, WATCH_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        lastHeard.current = Date.now();
        if (event.data === 'pong') return;
        let frame: ServerFrame;
        try {
          frame = JSON.parse(event.data as string) as ServerFrame;
        } catch {
          return;
        }
        handle(frame);
      };

      ws.onclose = () => {
        if (pingTimer) clearInterval(pingTimer);
        socket.current = null;
        if (closedByUs.current) return;
        setState((s) => ({ ...s, connection: 'reconnecting' }));
        const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempt.current);
        attempt.current += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    const handle = (frame: ServerFrame) => {
      switch (frame.t) {
        case 'hello': {
          const last = frame.messages.at(-1);
          if (last) lastSeq.current = last.seq;
          setState((s) => ({
            ...s,
            connection: 'open',
            you: frame.you,
            roster: frame.roster,
            call: frame.call,
            messages: merge(s.messages, frame.messages),
          }));
          return;
        }
        case 'roster':
          setState((s) => ({ ...s, roster: frame.roster }));
          return;
        case 'night':
          setState((s) => ({ ...s, night: frame.night }));
          return;
        case 'rooms':
          setState((s) => ({ ...s, rooms: frame.rooms }));
          return;
        case 'call-roster':
          setState((s) => ({ ...s, call: frame.members }));
          return;
        case 'rtc':
          // Handed straight to whoever is running the call; the room hook has
          // no business knowing what a session description is.
          onSignalRef.current(frame.from, frame.name, frame.payload);
          return;
        case 'msg': {
          lastSeq.current = Math.max(lastSeq.current, frame.message.seq);
          clearTyping(frame.message.memberId);
          // Our own line, come back. Now — and not when ws.send returned — is
          // when it has actually been said.
          const held = outbox.current.length;
          if (frame.cid !== undefined) {
            outbox.current = outbox.current.filter((l) => l.cid !== frame.cid);
          }
          const waiting = outbox.current.length;
          setState((s) => ({
            ...s,
            messages: merge(s.messages, [frame.message]),
            ...(waiting === held ? {} : { waiting }),
          }));
          return;
        }
        case 'typing': {
          const existing = typingTimers.current.get(frame.memberId);
          if (existing) clearTimeout(existing);
          typingTimers.current.set(
            frame.memberId,
            setTimeout(() => clearTyping(frame.memberId), TYPING_TTL_MS),
          );
          setState((s) => {
            const typing = new Map(s.typing);
            typing.set(frame.memberId, frame.name);
            return { ...s, typing };
          });
          return;
        }
        case 'error':
          console.warn('room:', frame.code);
          // A line the room will not take — empty, too long, a photo it cannot
          // find. It will never come back with its id, so the oldest one still
          // in flight is the one it is about, and holding it would mean
          // re-sending it all evening.
          if (frame.code !== 'bad_frame' && outbox.current.length > 0) {
            outbox.current = outbox.current.slice(1);
            setState((s) => ({ ...s, waiting: outbox.current.length }));
          }
          return;
      }
    };

    const clearTyping = (memberId: string | null) => {
      if (!memberId) return;
      const timer = typingTimers.current.get(memberId);
      if (timer) clearTimeout(timer);
      typingTimers.current.delete(memberId);
      setState((s) => {
        if (!s.typing.has(memberId)) return s;
        const typing = new Map(s.typing);
        typing.delete(memberId);
        return { ...s, typing };
      });
    };

    connect();

    return () => {
      closedByUs.current = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) clearInterval(pingTimer);
      for (const t of typingTimers.current.values()) clearTimeout(t);
      typingTimers.current.clear();
      socket.current?.close();
      socket.current = null;
    };
  }, [enabled]);

  /**
   * Say something. Always accepted — if it cannot go now it waits.
   *
   * It returns nothing because there is no longer an answer worth giving: the
   * composer used to hold the draft when the send failed and leave the dad
   * looking at his own words, wondering whether to press it again.
   *
   * Every line is held until it comes BACK from the room carrying its own id,
   * not merely until `ws.send` did not throw. A socket the network has
   * abandoned swallows sends silently, which is the whole failure this exists
   * to survive.
   */
  const send = useCallback((body: string, mediaId?: string) => {
    const cid = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const line = mediaId === undefined ? { cid, body, tries: 0 } : { cid, body, mediaId, tries: 0 };
    // Past the cap the oldest goes, not the newest: what he just typed is the
    // one he is still looking at.
    outbox.current = [...outbox.current, line].slice(-OUTBOX_LIMIT);
    setState((s) => ({ ...s, waiting: outbox.current.length }));

    const ws = socket.current;
    if (ws && ws.readyState === WebSocket.OPEN) sendLine(ws, line);
  }, []);

  const answerPrompt = useCallback((body: string) => {
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ t: 'prompt', body }));
    return true;
  }, []);

  /** Relay something the table said. Dropped on the floor if the socket is
   * down: a missed "a game started" is not worth queueing. */
  const relayTableEvent = useCallback((event: TableEvent) => {
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ t: 'table', event }));
  }, []);

  /** Sitting down at, or getting up from, the call. */
  const setInCall = useCallback((join: boolean, muted?: boolean) => {
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ t: 'call', join, muted: muted === true }));
  }, []);

  /** One leg of a handshake, addressed to one dad. */
  const sendSignal = useCallback((to: string, payload: unknown) => {
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ t: 'rtc', to, payload }));
  }, []);

  const lastTypingSent = useRef(0);
  const sendTyping = useCallback(() => {
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (now - lastTypingSent.current < 1500) return;
    lastTypingSent.current = now;
    ws.send(JSON.stringify({ t: 'typing' }));
  }, []);

  return {
    ...state,
    send,
    answerPrompt,
    relayTableEvent,
    sendTyping,
    setInCall,
    sendSignal,
    onSignalRef,
  };
}

/** Append by seq, dropping anything already held. Backfill and live frames
 * can overlap around a reconnect; a line must never render twice. */
function merge(have: RoomMessage[], incoming: RoomMessage[]): RoomMessage[] {
  if (incoming.length === 0) return have;
  const seen = new Set(have.map((m) => m.seq));
  const fresh = incoming.filter((m) => !seen.has(m.seq));
  if (fresh.length === 0) return have;
  return [...have, ...fresh].sort((a, b) => a.seq - b.seq);
}

/**
 * Put one held line down the socket, and remember that we did.
 *
 * `sentAt` is what the watchdog reads: a line sent and never echoed back is
 * how a socket that lies about being open gives itself away.
 */
function sendLine(
  ws: WebSocket,
  line: { cid: string; body: string; mediaId?: string; sentAt?: number; tries: number },
): void {
  line.sentAt = Date.now();
  line.tries += 1;
  ws.send(
    JSON.stringify(
      line.mediaId === undefined
        ? { t: 'chat', cid: line.cid, body: line.body }
        : { t: 'chat', cid: line.cid, body: line.body, mediaId: line.mediaId },
    ),
  );
}
