import { useCallback, useEffect, useRef, useState } from 'react';
import type { RosterEntry } from '../shared/protocol';

/**
 * Voice, and optionally camera, between the dads in the room.
 *
 * A full mesh: every dad connects directly to every other one. That is the
 * wrong shape for a hundred people and exactly the right shape for five —
 * no server in the media path, nothing to run, nothing to pay for, and the
 * quality is as good as the two connections involved.
 *
 * The handshake rides the room's existing websocket. There is no second
 * connection to open, authenticate or keep alive, and the room already knows
 * who everybody is.
 */

export interface Peer {
  memberId: string;
  name: string;
  stream: MediaStream;
  /** Whether that dad is currently sending pictures as well as sound. */
  hasVideo: boolean;
}

export type CallState = 'out' | 'joining' | 'in' | 'denied' | 'failed';

interface Signal {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  hangup?: true;
}

type Send = (to: string, payload: unknown) => void;

async function iceServers(): Promise<RTCIceServer[]> {
  try {
    const res = await fetch('/api/ice');
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { iceServers: RTCIceServer[] };
    return body.iceServers;
  } catch {
    // The endpoint is built never to fail, but a network blip should not stop
    // a call that STUN alone would have carried.
    return [{ urls: 'stun:stun.cloudflare.com:3478' }];
  }
}

/**
 * Both ends decide the same way who offers, without asking each other.
 * Without a rule, two simultaneous offers collide and neither connects.
 */
function iOffer(me: string, them: string): boolean {
  return me < them;
}

export function useCall({
  you,
  members,
  send,
  onJoinChange,
}: {
  you: string | null;
  /** Who the room says is on the call, this dad included. */
  members: RosterEntry[];
  send: Send;
  onJoinChange: (join: boolean) => void;
}) {
  const [state, setState] = useState<CallState>('out');
  const [peers, setPeers] = useState<Peer[]>([]);
  const [muted, setMuted] = useState(false);
  const [camera, setCamera] = useState(false);

  const local = useRef<MediaStream | null>(null);
  const connections = useRef(new Map<string, RTCPeerConnection>());
  const streams = useRef(new Map<string, MediaStream>());
  const names = useRef(new Map<string, string>());
  /** Candidates that arrived before the description they belong to. */
  const early = useRef(new Map<string, RTCIceCandidateInit[]>());

  const publish = useCallback(() => {
    setPeers(
      [...streams.current.entries()].map(([memberId, stream]) => ({
        memberId,
        name: names.current.get(memberId) ?? 'a dad',
        stream,
        hasVideo: stream.getVideoTracks().some((t) => t.readyState === 'live'),
      })),
    );
  }, []);

  const teardown = useCallback(
    (memberId: string) => {
      connections.current.get(memberId)?.close();
      connections.current.delete(memberId);
      streams.current.delete(memberId);
      early.current.delete(memberId);
      publish();
    },
    [publish],
  );

  const connectionFor = useCallback(
    (memberId: string, servers: RTCIceServer[]): RTCPeerConnection => {
      const existing = connections.current.get(memberId);
      if (existing !== undefined) return existing;

      const pc = new RTCPeerConnection({ iceServers: servers });
      connections.current.set(memberId, pc);

      for (const track of local.current?.getTracks() ?? []) {
        pc.addTrack(track, local.current!);
      }

      pc.onicecandidate = (event) => {
        if (event.candidate !== null) send(memberId, { candidate: event.candidate.toJSON() });
      };

      pc.ontrack = (event) => {
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        streams.current.set(memberId, stream);
        // A dad turning his camera on or off changes what this stream holds
        // without any renegotiation we would otherwise notice.
        stream.onaddtrack = publish;
        stream.onremovetrack = publish;
        publish();
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          teardown(memberId);
        }
      };

      return pc;
    },
    [publish, send, teardown],
  );

  /** Everything the microphone is attached to, gone. */
  const stop = useCallback(() => {
    for (const pc of connections.current.values()) pc.close();
    connections.current.clear();
    streams.current.clear();
    early.current.clear();
    for (const track of local.current?.getTracks() ?? []) track.stop();
    local.current = null;
    setPeers([]);
    setCamera(false);
    setMuted(false);
  }, []);

  const join = useCallback(async () => {
    setState('joining');
    try {
      local.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      // Refusing the microphone is a choice, not a fault; anything else is a
      // device that will not open.
      setState((err as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'failed');
      return;
    }
    setState('in');
    onJoinChange(true);
  }, [onJoinChange]);

  const leave = useCallback(() => {
    stop();
    setState('out');
    onJoinChange(false);
  }, [onJoinChange, stop]);

  /** Mute is a track that stops sending, not a track that goes away: the
   * connection stays up and the others' tiles do not flicker. */
  const toggleMute = useCallback(() => {
    const tracks = local.current?.getAudioTracks() ?? [];
    const next = !muted;
    for (const track of tracks) track.enabled = !next;
    setMuted(next);
  }, [muted]);

  const toggleCamera = useCallback(async () => {
    if (local.current === null) return;

    if (camera) {
      for (const track of local.current.getVideoTracks()) {
        track.stop();
        local.current.removeTrack(track);
        for (const pc of connections.current.values()) {
          const sender = pc.getSenders().find((s) => s.track === track);
          if (sender !== undefined) pc.removeTrack(sender);
        }
      }
      setCamera(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const track = stream.getVideoTracks()[0];
      if (track === undefined) return;
      local.current.addTrack(track);
      for (const pc of connections.current.values()) pc.addTrack(track, local.current);
      setCamera(true);
    } catch {
      // No camera, or refused. The call carries on with sound.
    }
  }, [camera]);

  /**
   * Handles one relayed signal. Kept in a ref so the socket handler does not
   * have to be rebuilt every time a peer appears.
   */
  const handleRef = useRef<(from: string, name: string, payload: unknown) => void>(() => {});

  useEffect(() => {
    handleRef.current = (from, name, payload) => {
      if (state !== 'in' || you === null || from === you) return;
      names.current.set(from, name);
      const signal = payload as Signal;

      if (signal.hangup === true) {
        teardown(from);
        return;
      }

      void (async () => {
        const servers = await iceServers();
        const pc = connectionFor(from, servers);

        if (signal.description !== undefined) {
          await pc.setRemoteDescription(signal.description);
          // Candidates that outran their description can be added now.
          for (const candidate of early.current.get(from) ?? []) {
            await pc.addIceCandidate(candidate).catch(() => {});
          }
          early.current.delete(from);

          if (signal.description.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            send(from, { description: answer });
          }
          return;
        }

        if (signal.candidate !== undefined) {
          if (pc.remoteDescription === null) {
            early.current.set(from, [...(early.current.get(from) ?? []), signal.candidate]);
            return;
          }
          await pc.addIceCandidate(signal.candidate).catch(() => {});
        }
      })();
    };
  }, [connectionFor, send, state, teardown, you]);

  /** Open a connection to anyone on the call we are not already talking to,
   * and drop anyone who has left. */
  useEffect(() => {
    if (state !== 'in' || you === null) return;

    const others = members.filter((m) => m.memberId !== you);
    for (const m of others) names.current.set(m.memberId, m.name);

    for (const memberId of [...connections.current.keys()]) {
      if (!others.some((m) => m.memberId === memberId)) teardown(memberId);
    }

    for (const other of others) {
      if (connections.current.has(other.memberId)) continue;
      if (!iOffer(you, other.memberId)) continue; // He calls us.
      void (async () => {
        const pc = connectionFor(other.memberId, await iceServers());
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        send(other.memberId, { description: offer });
      })();
    }
  }, [connectionFor, members, send, state, teardown, you]);

  useEffect(() => stop, [stop]);

  return {
    state,
    peers,
    muted,
    camera,
    join,
    leave,
    toggleMute,
    toggleCamera,
    localStream: local,
    onSignal: (from: string, name: string, payload: unknown) =>
      handleRef.current(from, name, payload),
  };
}
