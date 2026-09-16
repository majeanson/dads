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
  /** Everyone in the group, present or not. Where a face comes from: the
   * roster is who is connected, and a line said on Tuesday by a man who is
   * not here tonight still wants his face beside it. */
  members: RosterEntry[];
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
    members: [],
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
    {
      cid: string;
      body: string;
      mediaId?: string;
      replyTo?: string;
      sentAt?: number;
      tries: number;
    }[]
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
          // A socket that resumed rather than reloaded is still holding lines
          // the room has lost. `gone` is how it finds out.
          const lost = new Set(frame.gone ?? []);
          setState((s) => ({
            ...s,
            connection: 'open',
            you: frame.you,
            roster: frame.roster,
            members: frame.members ?? s.members,
            call: frame.call,
            messages: merge(
              lost.size === 0 ? s.messages : s.messages.filter((m) => !lost.has(m.id)),
              frame.messages,
            ),
          }));
          return;
        }
        case 'gone':
          setState((s) => ({ ...s, messages: s.messages.filter((m) => m.id !== frame.id) }));
          return;
        case 'reacted':
          setState((s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === frame.id ? { ...m, reactions: frame.reactions } : m,
            ),
          }));
          return;
        case 'edited':
          setState((s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === frame.id ? { ...m, body: frame.body, editedAt: frame.editedAt } : m,
            ),
          }));
          return;
        case 'kept':
          // By media id, not by line: the pruner knows a picture by the id on
          // the shelf, and that is what the room broadcast.
          setState((s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.media?.id === frame.mediaId ? { ...m, media: { ...m.media, kept: frame.on } } : m,
            ),
          }));
          return;
        case 'roster':
          setState((s) => ({ ...s, roster: frame.roster }));
          return;
        case 'member':
          // Upsert rather than replace: this is one dad changing, and the
          // other four are unaffected.
          setState((s) => ({
            ...s,
            members: [
              ...s.members.filter((m) => m.memberId !== frame.member.memberId),
              frame.member,
            ],
          }));
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
  const send = useCallback((body: string, mediaId?: string, replyTo?: string) => {
    const cid = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const line = {
      cid,
      body,
      tries: 0,
      ...(mediaId === undefined ? {} : { mediaId }),
      ...(replyTo === undefined ? {} : { replyTo }),
    };
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

  /**
   * Take a line back.
   *
   * Not optimistic, and that is the point: the line stays on his own screen
   * until the room says it is gone, so what he sees is the truth about what
   * everyone else sees. A retraction that vanished locally and failed on the
   * wire would be the worst possible lie for this particular feature.
   */
  const retract = useCallback((id: string) => {
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ t: 'retract', id }));
  }, []);

  /**
   * Change the words of a line you typed. Not optimistic, like taking one
   * back: the old words stay on his screen until the room says otherwise.
   * False when the socket is down, so the composer can keep the draft.
   */
  const edit = useCallback((id: string, body: string) => {
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ t: 'edit', id, body }));
    return true;
  }, []);

  /**
   * Put a mark on a line, or take yours off.
   *
   * Optimistic, unlike taking a line back — the opposite call for the
   * opposite reason. A mark that does not land costs nothing and the next
   * frame from the room corrects it, and a tap that takes a beat to answer is
   * the difference between this feeling like a button and feeling like a
   * form.
   */
  const react = useCallback((id: string, emoji: string, on: boolean, me: string) => {
    setState((s) => ({
      ...s,
      messages: s.messages.map((m) => {
        if (m.id !== id) return m;
        const list = (m.reactions ?? []).map((r) => ({ ...r, by: [...r.by] }));
        const mark = list.find((r) => r.emoji === emoji);
        if (on) {
          if (mark) {
            if (!mark.by.includes(me)) mark.by.push(me);
          } else list.push({ emoji, by: [me] });
        } else if (mark) {
          mark.by = mark.by.filter((who) => who !== me);
        }
        return { ...m, reactions: list.filter((r) => r.by.length > 0) };
      }),
    }));
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'react', id, emoji, on }));
  }, []);

  return {
    ...state,
    send,
    retract,
    edit,
    react,
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
  line: {
    cid: string;
    body: string;
    mediaId?: string;
    replyTo?: string;
    sentAt?: number;
    tries: number;
  },
): void {
  line.sentAt = Date.now();
  line.tries += 1;
  ws.send(
    JSON.stringify({
      t: 'chat',
      cid: line.cid,
      body: line.body,
      ...(line.mediaId === undefined ? {} : { mediaId: line.mediaId }),
      ...(line.replyTo === undefined ? {} : { replyTo: line.replyTo }),
    }),
  );
}
