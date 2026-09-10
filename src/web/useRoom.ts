import { useCallback, useEffect, useRef, useState } from 'react';
import type { DadNight } from '../shared/dadNight';
import type { CallMember } from '../shared/protocol';
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
}

const PING_INTERVAL_MS = 30_000;
const TYPING_TTL_MS = 4_000;
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 15_000;

/**
 * One socket to the group's room. Reconnects with backoff and asks only for
 * what it missed (`after=<last seq>`), so a phone that hopped networks sees
 * the three lines it lost, not the whole evening again.
 */
export function useRoom(enabled: boolean, initialNight: DadNight | null) {
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
  });

  const socket = useRef<WebSocket | null>(null);
  const lastSeq = useRef(0);
  const attempt = useRef(0);
  const typingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
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
        pingTimer = setInterval(() => {
          // Guarded like every other send here: the socket can enter CLOSING
          // between the tick and the send, and an unhandled throw in a timer
          // is a hard error rather than a dropped keepalive.
          if (ws.readyState === WebSocket.OPEN) ws.send('ping');
        }, PING_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
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
          setState((s) => ({ ...s, messages: merge(s.messages, [frame.message]) }));
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

  const send = useCallback((body: string, mediaId?: string) => {
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(
      JSON.stringify(mediaId === undefined ? { t: 'chat', body } : { t: 'chat', body, mediaId }),
    );
    return true;
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
