import { useEffect, useRef } from 'react';
import { useT } from './i18n';
import type { Peer } from './useCall';

/**
 * The call, along the top of the room.
 *
 * Sound is the point and pictures are optional, so a dad with his camera off
 * is a name and nothing else — no empty black rectangle taking up a phone
 * screen. Tiles only appear for the dads actually showing something.
 */
export function CallBar({
  state,
  peers,
  muted,
  camera,
  localStream,
  onJoin,
  onLeave,
  onToggleMute,
  onToggleCamera,
}: {
  state: 'out' | 'joining' | 'in' | 'denied' | 'failed';
  peers: Peer[];
  muted: boolean;
  camera: boolean;
  localStream: MediaStream | null;
  onJoin: () => void;
  onLeave: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
}) {
  const { t } = useT();

  if (state === 'out' || state === 'joining') {
    return (
      <div className="call call-out">
        <button type="button" onClick={onJoin} disabled={state === 'joining'}>
          {state === 'joining' ? t('call.opening') : t('call.join')}
        </button>
      </div>
    );
  }

  if (state === 'denied' || state === 'failed') {
    return (
      <div className="call call-out">
        <p className="quiet" role="alert">
          {state === 'denied' ? t('call.denied') : t('call.failed')}
        </p>
        <button type="button" onClick={onJoin}>
          {t('call.retry')}
        </button>
      </div>
    );
  }

  const showing = peers.filter((p) => p.hasVideo);
  const listening = peers.filter((p) => !p.hasVideo);

  return (
    <div className="call" data-testid="call">
      <div className="call-actions">
        <button type="button" aria-pressed={muted} onClick={onToggleMute}>
          {muted ? t('call.unmute') : t('call.mute')}
        </button>
        <button type="button" aria-pressed={camera} onClick={onToggleCamera}>
          {camera ? t('call.camera_off') : t('call.camera_on')}
        </button>
        <button type="button" className="link" onClick={onLeave}>
          {t('call.leave')}
        </button>
        <span className="quiet call-count">
          {peers.length === 0 ? t('call.alone') : t('call.count', { n: peers.length + 1 })}
        </span>
      </div>

      {showing.length > 0 || camera ? (
        <div className="call-tiles">
          {camera && localStream !== null ? (
            <Tile stream={localStream} name={t('call.you')} muted />
          ) : null}
          {/* Silent: every dad's sound comes from the <audio> elements
              below, so a camera going on or off never interrupts what you can
              hear — and nobody is played twice. */}
          {showing.map((p) => (
            <Tile key={p.memberId} stream={p.stream} name={p.name} muted />
          ))}
        </div>
      ) : null}

      {/* Sound for everyone, whether or not they are on screen. */}
      {listening.map((p) => (
        <Audio key={p.memberId} stream={p.stream} />
      ))}
      {showing.map((p) => (
        <Audio key={`a-${p.memberId}`} stream={p.stream} />
      ))}

      {listening.length > 0 ? (
        <p className="quiet call-listening">{listening.map((p) => p.name).join(', ')}</p>
      ) : null}
    </div>
  );
}

function Tile({ stream, name, muted }: { stream: MediaStream; name: string; muted: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current !== null) video.current.srcObject = stream;
  }, [stream]);
  return (
    <figure className="call-tile" data-testid="call-tile">
      {/* Always silent — your own because hearing yourself is unusable,
          everyone else's because their sound comes from an <audio>. */}
      <video ref={video} autoPlay playsInline muted={muted} />
      <figcaption>{name}</figcaption>
    </figure>
  );
}

/**
 * A dad's sound, with no picture. An <audio> element rather than the video
 * tile's own track, so turning a camera on and off never interrupts what you
 * can hear.
 */
function Audio({ stream }: { stream: MediaStream }) {
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (audio.current !== null) audio.current.srcObject = stream;
  }, [stream]);
  return <audio ref={audio} autoPlay />;
}
