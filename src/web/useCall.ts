import { useCallback, useEffect, useRef, useState } from 'react';
import type { CallMember } from '../shared/protocol';
import { SpeakingWatch } from './speaking';
import { useWakeLock } from './wakeLock';

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
 *
 * Negotiation follows the "perfect negotiation" pattern rather than a
 * hand-rolled one-sided offer. That matters for more than glare: adding or
 * removing a camera track mid-call needs a FRESH offer, and a design where
 * only one side may ever offer leaves the other side's camera toggle inert.
 */

export interface Peer {
  memberId: string;
  name: string;
  stream: MediaStream;
  /** Whether that dad is currently sending pictures as well as sound. */
  hasVideo: boolean;
  /** He has stopped his own microphone. Told to us by the room, because a
   * muted track is indistinguishable from a quiet one out here. */
  muted: boolean;
  /** He is talking right now. Worked out locally from his own audio. */
  speaking: boolean;
}

export type CallState = 'out' | 'joining' | 'in' | 'denied' | 'failed';

interface Signal {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  hangup?: true;
}

type Send = (to: string, payload: unknown) => void;

interface PeerLink {
  pc: RTCPeerConnection;
  /**
   * Perfect negotiation's two flags. `polite` yields when two offers cross;
   * the impolite side ignores the incoming one and its own offer wins.
   */
  polite: boolean;
  makingOffer: boolean;
  /** Candidates that outran the description they belong to. */
  early: RTCIceCandidateInit[];
}

const FALLBACK_ICE: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];

/** What this dad's own microphone is watched under: not a member id, so it
 * can never collide with one. */
const YOU = 'you';

/**
 * Asked for once per call, not once per signal.
 *
 * The endpoint is `no-store`, so the browser will not cache it, and each hit
 * mints fresh TURN credentials on our account. A four-dad mesh trades dozens
 * of ICE candidates; fetching per candidate would put a round trip in the
 * middle of the ICE path dozens of times and mint credentials for each.
 */
let icePromise: Promise<RTCIceServer[]> | null = null;

function iceServers(): Promise<RTCIceServer[]> {
  icePromise ??= fetch('/api/ice')
    .then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res.json() as Promise<{ iceServers: RTCIceServer[] }>;
    })
    .then((body) => body.iceServers)
    .catch(() => {
      // The endpoint is built never to fail, but a blip should not stop a call
      // that STUN alone would have carried. Forget it so the next call retries.
      icePromise = null;
      return FALLBACK_ICE;
    });
  return icePromise;
}

export function useCall({
  you,
  members,
  send,
  onJoinChange,
}: {
  you: string | null;
  /** Who the room says is on the call, this dad included. */
  members: CallMember[];
  send: Send;
  onJoinChange: (join: boolean, muted?: boolean) => void;
}) {
  const [state, setState] = useState<CallState>('out');
  const [peers, setPeers] = useState<Peer[]>([]);
  const [muted, setMuted] = useState(false);
  const [camera, setCamera] = useState(false);
  const [speaking, setSpeaking] = useState<string[]>([]);

  // A phone locks itself after half a minute of a dad listening rather than
  // touching it, which is most of a call.
  useWakeLock(state === 'in');

  const local = useRef<MediaStream | null>(null);
  const links = useRef(new Map<string, PeerLink>());
  const streams = useRef(new Map<string, MediaStream>());
  const names = useRef(new Map<string, string>());
  const mutes = useRef(new Map<string, boolean>());
  const watch = useRef<SpeakingWatch | null>(null);

  const publish = useCallback(() => {
    setPeers(
      [...streams.current.entries()].map(([memberId, stream]) => ({
        memberId,
        name: names.current.get(memberId) ?? 'a dad',
        stream,
        hasVideo: stream.getVideoTracks().some((t) => t.readyState === 'live'),
        muted: mutes.current.get(memberId) === true,
        speaking: false,
      })),
    );
  }, []);

  const teardown = useCallback(
    (memberId: string) => {
      links.current.get(memberId)?.pc.close();
      links.current.delete(memberId);
      streams.current.delete(memberId);
      watch.current?.drop(memberId);
      publish();
    },
    [publish],
  );

  /**
   * Opens the connection to one dad, or returns the one already open.
   *
   * Both sides call this as soon as they see each other on the call roster —
   * there is no designated caller. Adding the local tracks fires
   * `negotiationneeded`, which is what actually sends the offer, and which is
   * the same path a camera toggle later takes.
   */
  const linkTo = useCallback(
    (memberId: string, servers: RTCIceServer[], me: string): PeerLink => {
      const existing = links.current.get(memberId);
      if (existing !== undefined) return existing;

      const pc = new RTCPeerConnection({ iceServers: servers });
      // Both ends must disagree about this, and must do so without asking.
      const link: PeerLink = { pc, polite: me > memberId, makingOffer: false, early: [] };
      links.current.set(memberId, link);

      pc.onnegotiationneeded = () => {
        void (async () => {
          try {
            link.makingOffer = true;
            await pc.setLocalDescription();
            if (pc.localDescription !== null) send(memberId, { description: pc.localDescription });
          } catch {
            // A connection closed mid-negotiation; teardown has it.
          } finally {
            link.makingOffer = false;
          }
        })();
      };

      pc.onicecandidate = (event) => {
        if (event.candidate !== null) send(memberId, { candidate: event.candidate.toJSON() });
      };

      pc.ontrack = (event) => {
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        streams.current.set(memberId, stream);
        watch.current?.watch(memberId, stream);
        // A camera going on or off changes what this stream holds without any
        // event we would otherwise notice.
        stream.onaddtrack = publish;
        stream.onremovetrack = publish;
        event.track.onended = publish;
        event.track.onmute = publish;
        event.track.onunmute = publish;
        publish();
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') {
          // A hiccup is not the end of the call. Restarting ICE fires
          // negotiationneeded again, so the pair re-forms itself; tearing the
          // connection down here would leave it dead for the rest of the
          // evening, because the roster never changed and nothing would
          // rebuild it.
          try {
            pc.restartIce();
          } catch {
            teardown(memberId);
          }
        } else if (pc.connectionState === 'closed') {
          teardown(memberId);
        }
      };

      for (const track of local.current?.getTracks() ?? []) {
        pc.addTrack(track, local.current!);
      }

      return link;
    },
    [publish, send, teardown],
  );

  /** Everything the microphone is attached to, gone. */
  const stop = useCallback(() => {
    for (const link of links.current.values()) link.pc.close();
    links.current.clear();
    streams.current.clear();
    watch.current?.close();
    watch.current = null;
    for (const track of local.current?.getTracks() ?? []) track.stop();
    local.current = null;
    setPeers([]);
    setSpeaking([]);
    setCamera(false);
    setMuted(false);
  }, []);

  const join = useCallback(async () => {
    setState('joining');
    try {
      // Spelled out rather than left to `audio: true`. Every browser turns
      // these on by default today, but a call between five men in five
      // kitchens is exactly the case they exist for, and a default is not a
      // promise.
      local.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      watch.current = new SpeakingWatch(setSpeaking);
      watch.current.watch(YOU, local.current);
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

  /** Mute is a track that stops sending, not a track that goes away: removing
   * it would renegotiate and make everyone's tiles flicker.
   *
   * The room is told, because from the other end a muted dad and a silent one
   * look identical — and "why is nobody answering me" is the whole reason to
   * say which. */
  const toggleMute = useCallback(() => {
    const next = !muted;
    for (const track of local.current?.getAudioTracks() ?? []) track.enabled = !next;
    setMuted(next);
    onJoinChange(true, next);
  }, [muted, onJoinChange]);

  /**
   * The camera. Adding or removing the track fires `negotiationneeded` on
   * every open connection, which is what carries the change to the others —
   * without that, the toggle would only ever change what this dad sees.
   */
  const toggleCamera = useCallback(async () => {
    if (local.current === null) return;

    if (camera) {
      for (const track of local.current.getVideoTracks()) {
        for (const link of links.current.values()) {
          const sender = link.pc.getSenders().find((s) => s.track === track);
          if (sender !== undefined) link.pc.removeTrack(sender);
        }
        track.stop();
        local.current.removeTrack(track);
      }
      setCamera(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const track = stream.getVideoTracks()[0];
      if (track === undefined) return;
      local.current.addTrack(track);
      for (const link of links.current.values()) link.pc.addTrack(track, local.current);
      setCamera(true);
    } catch {
      // No camera, or refused. The call carries on with sound.
    }
  }, [camera]);

  /**
   * One relayed signal. Held in a ref so the socket handler never has to be
   * rebuilt as peers come and go.
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
        const link = linkTo(from, await iceServers(), you);
        const { pc } = link;

        try {
          if (signal.description !== undefined) {
            // Perfect negotiation: if an offer arrives while we are making one
            // of our own, exactly one side gives way, and it is always the
            // same side.
            const collision =
              signal.description.type === 'offer' &&
              (link.makingOffer || pc.signalingState !== 'stable');
            if (!link.polite && collision) return;

            await pc.setRemoteDescription(signal.description);
            for (const candidate of link.early) {
              await pc.addIceCandidate(candidate).catch(() => {});
            }
            link.early = [];

            if (signal.description.type === 'offer') {
              await pc.setLocalDescription();
              if (pc.localDescription !== null) send(from, { description: pc.localDescription });
            }
            return;
          }

          if (signal.candidate !== undefined) {
            if (pc.remoteDescription === null) {
              link.early.push(signal.candidate);
              return;
            }
            await pc.addIceCandidate(signal.candidate).catch(() => {});
          }
        } catch {
          // A description that no longer applies to this connection's state.
          // The next negotiation supersedes it.
        }
      })();
    };
  }, [linkTo, send, state, teardown, you]);

  /**
   * Open a connection to anyone on the call we are not already talking to, and
   * drop anyone who has left. Both sides do this; `negotiationneeded` and the
   * politeness rule sort out who ends up offering.
   */
  useEffect(() => {
    if (state !== 'in' || you === null) return;

    const others = members.filter((m) => m.memberId !== you);
    for (const m of others) {
      names.current.set(m.memberId, m.name);
      mutes.current.set(m.memberId, m.muted === true);
    }
    publish();

    for (const memberId of [...links.current.keys()]) {
      if (!others.some((m) => m.memberId === memberId)) teardown(memberId);
    }

    let cancelled = false;
    void (async () => {
      const servers = await iceServers();
      if (cancelled) return;
      for (const other of others) linkTo(other.memberId, servers, you);
    })();

    return () => {
      cancelled = true;
    };
  }, [linkTo, members, publish, state, teardown, you]);

  useEffect(() => stop, [stop]);

  return {
    state,
    // Merged here rather than in `publish` so that a mark going on and off
    // several times a second never rebuilds a peer's stream object — which
    // would hand every <video> a "new" source and make the tiles flicker.
    peers: peers.map((p) => ({ ...p, speaking: speaking.includes(p.memberId) })),
    speakingYou: speaking.includes(YOU),
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
