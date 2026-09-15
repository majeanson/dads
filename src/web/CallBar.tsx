import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useT } from './i18n';
import { Button } from './ui/Button';
import type { Peer } from './useCall';

/**
 * The call, along the top of the room — and only while there is one.
 *
 * Sound is the point and pictures are optional, so a dad with his camera off
 * is a name and nothing else — no empty black rectangle taking up a phone
 * screen. Tiles only appear for the dads actually showing something.
 *
 * Joining lives in the header (see `JoinCall`): the resting room is the
 * conversation and nothing else.
 */
export function CallBar({
  state,
  peers,
  muted,
  camera,
  speakingYou,
  localStream,
  onLeave,
  onToggleMute,
  onToggleCamera,
  onWho,
}: {
  state: 'out' | 'joining' | 'in' | 'denied' | 'failed';
  peers: Peer[];
  muted: boolean;
  camera: boolean;
  speakingYou: boolean;
  localStream: MediaStream | null;
  onLeave: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  /** Opens who's here, which is where the names and the mute marks live. */
  onWho: () => void;
}) {
  const { t } = useT();
  /** The one tile a dad has asked to actually look at. */
  const [big, setBig] = useState<string | null>(null);

  // Out of a call there is nothing to show: the way in is a button in the
  // header, because a whole row saying "no call is happening" is a row of
  // conversation nobody can see.
  if (state === 'out' || state === 'joining') return null;

  const showing = peers.filter((p) => p.hasVideo);
  const listening = peers.filter((p) => !p.hasVideo);
  // A tile that has gone away cannot stay enlarged.
  const enlarged =
    big !== null && (big === 'you' ? camera : showing.some((p) => p.memberId === big)) ? big : null;

  return (
    <div className="call" data-testid="call" data-big={enlarged === null ? undefined : 'yes'}>
      <div className="call-actions">
        <Button
          size="md"
          aria-pressed={muted}
          onClick={onToggleMute}
          className={muted ? 'border-danger text-danger' : ''}
        >
          {muted ? <MicOff size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
          <span className="max-[26rem]:sr-only">{muted ? t('call.unmute') : t('call.mute')}</span>
        </Button>
        <Button
          size="md"
          aria-pressed={camera}
          onClick={onToggleCamera}
          className={camera ? 'border-accent text-accent' : ''}
        >
          {camera ? (
            <VideoOff size={18} aria-hidden="true" />
          ) : (
            <Video size={18} aria-hidden="true" />
          )}
          <span className="max-[26rem]:sr-only">
            {camera ? t('call.camera_off') : t('call.camera_on')}
          </span>
        </Button>
        <Button size="md" look="danger" onClick={onLeave} aria-label={t('call.leave')}>
          <PhoneOff size={18} aria-hidden="true" />
          <span className="max-[26rem]:sr-only">{t('call.leave')}</span>
        </Button>
        {/* The count is the way to the names. It used to be a row of names
            under the buttons, with the muted ones faded: a row of conversation
            spent on something the sheet says better. */}
        <button
          type="button"
          className="count-in ml-auto shrink truncate text-base text-muted"
          onClick={onWho}
          data-testid="call-count"
        >
          {peers.length === 0 ? t('call.alone') : t('call.count', { n: peers.length + 1 })}
        </button>
      </div>

      {showing.length > 0 || camera ? (
        <div className="call-tiles">
          {camera && localStream !== null ? (
            <Tile
              stream={localStream}
              name={t('call.you')}
              speaking={speakingYou && !muted}
              muted
              big={enlarged === 'you'}
              onToggleBig={() => setBig(enlarged === 'you' ? null : 'you')}
            />
          ) : null}
          {/* Silent: every dad's sound comes from the <audio> elements
              below, so a camera going on or off never interrupts what you can
              hear — and nobody is played twice. */}
          {showing.map((p) => (
            <Tile
              key={p.memberId}
              stream={p.stream}
              name={p.name}
              speaking={p.speaking}
              quiet={p.muted}
              muted
              big={enlarged === p.memberId}
              onToggleBig={() => setBig(enlarged === p.memberId ? null : p.memberId)}
            />
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
    </div>
  );
}

/**
 * The way into the call, for the header.
 *
 * Also where the microphone's refusals are said, because that is where the
 * dad just pressed something and is owed an answer.
 *
 * Two shapes, like the bar it sits in: on home it is as tall as the bar and
 * carries its words on a wide screen; in the conversation (`compact`) it is a
 * plain 44px square with the words for a screen reader only.
 */
export function JoinCall({
  state,
  onJoin,
  compact = false,
}: {
  state: 'out' | 'joining' | 'in' | 'denied' | 'failed';
  onJoin: () => void;
  compact?: boolean;
}) {
  const { t } = useT();
  if (state === 'in') return null;

  const size = compact ? 'icon' : 'md';
  const shape = compact ? '' : 'h-auto min-h-11 self-stretch max-[48rem]:w-14 max-[48rem]:px-0';
  const words = compact ? 'sr-only' : 'max-[48rem]:sr-only';
  const glyph = compact ? 22 : 26;

  if (state === 'denied' || state === 'failed') {
    return (
      <Button
        look="danger"
        size={size}
        onClick={onJoin}
        title={t(`call.${state}`)}
        aria-label={t('call.retry')}
        className={shape}
      >
        <MicOff size={glyph} aria-hidden="true" />
        <span className={words}>{t('call.retry')}</span>
        <span className="sr-only"> — {t(`call.${state}`)}</span>
      </Button>
    );
  }

  return (
    <Button
      size={size}
      onClick={onJoin}
      disabled={state === 'joining'}
      aria-label={t('call.join')}
      className={shape}
    >
      <Phone size={glyph} aria-hidden="true" />
      <span className={words}>{state === 'joining' ? t('call.opening') : t('call.join')}</span>
    </Button>
  );
}

/**
 * One dad's picture.
 *
 * The whole tile is the button: on a phone there is no room for a control
 * beside it, and "tap the man to see the man" needs no explaining. Enlarged,
 * it is still in the same place in the same list — it just stops being a
 * thumbnail.
 */
function Tile({
  stream,
  name,
  speaking,
  quiet = false,
  muted,
  big,
  onToggleBig,
}: {
  stream: MediaStream;
  name: string;
  speaking: boolean;
  quiet?: boolean;
  muted: boolean;
  big: boolean;
  onToggleBig: () => void;
}) {
  const { t } = useT();
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current !== null) video.current.srcObject = stream;
  }, [stream]);

  return (
    <figure
      className={`call-tile${speaking ? ' is-speaking' : ''}`}
      data-testid="call-tile"
      data-big={big ? 'yes' : undefined}
    >
      <button
        type="button"
        onClick={onToggleBig}
        aria-pressed={big}
        className="block w-full cursor-pointer border-0 bg-transparent p-0"
      >
        {/* Always silent — your own because hearing yourself is unusable,
            everyone else's because their sound comes from an <audio>. */}
        <video ref={video} autoPlay playsInline muted={muted} />
        <span className="sr-only">{big ? t('call.shrink') : t('call.enlarge')}</span>
      </button>
      <figcaption>
        {name}
        {/* The glyph and its words, not a bare ✕ named only by a `title` — a
            screen reader may never announce one and a phone never shows it.
            currentColor on purpose: the ground behind this is a moving
            picture, and the caption's own pair is the only audited one. */}
        {quiet ? (
          <span className="ml-1 inline-flex items-center align-[-0.1em]">
            <MicOff size={12} aria-hidden="true" />
            <span className="sr-only"> — {t('call.is_muted')}</span>
          </span>
        ) : null}
      </figcaption>
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
