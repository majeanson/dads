import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { FIT_LIMITS, parseFit, type GlassesFit } from '../shared/protocol';
import { setMyGlassesFit } from './api';
import { Face } from './Face';
import { useT } from './i18n';
import { useMember } from './members';
import { Button } from './ui/Button';

/** Where a pair sits before anybody moves it. */
const MIDDLE: GlassesFit = { x: 0, y: 0, s: 1 };
/** The face in the preview: big enough to see eyes on, small enough for a
 * phone's popover. A drag is measured against it, so the pair tracks the finger. */
const FACE = 144;

/**
 * Put his glasses where his eyes are.
 *
 * A photograph's eyes are wherever the camera put them, and one fixed spot
 * sat a pair on some men's foreheads and other men's chins. He drags the
 * pair on a big copy of his face, sizes it with a slider, and saves — and
 * every face of his in the room wears it there. Only over a photo: a face
 * with none is drawn to fit.
 *
 * The preview is a control like any other: focusable, the arrow keys move
 * the pair (Shift for bigger steps), and its name says so. Not optimistic,
 * like choosing a pair: it is his once the room has it.
 */
export function GlassesFitter({
  memberId,
  photo,
  onDone,
}: {
  memberId: string;
  /** A photo he picked a moment ago, before the room has it. */
  photo?: string | false | null;
  onDone: () => void;
}) {
  const { t } = useT();
  const me = useMember(memberId);
  const [draft, setDraft] = useState<GlassesFit>(me?.fit ?? MIDDLE);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const drag = useRef<{ x: number; y: number; from: GlassesFit } | null>(null);

  const place = (next: GlassesFit) => setDraft(parseFit(next) ?? MIDDLE);

  function down(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, from: draft };
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (d === null) return;
    place({
      ...d.from,
      x: d.from.x + (event.clientX - d.x) / FACE,
      y: d.from.y + (event.clientY - d.y) / FACE,
    });
  }
  function up() {
    drag.current = null;
  }
  function key(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 0.05 : 0.01;
    const by: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = by[event.key];
    if (d === undefined) return;
    event.preventDefault();
    place({ ...draft, x: draft.x + d[0], y: draft.y + d[1] });
  }

  async function save() {
    setBusy(true);
    setFailed(false);
    try {
      const middle = draft.x === 0 && draft.y === 0 && draft.s === 1;
      await setMyGlassesFit(middle ? null : draft);
      onDone();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid w-[13rem] gap-3" data-testid="glasses-fitter">
      <p className="m-0 text-[1.0625rem] font-semibold">{t('fit.title')}</p>
      <div
        role="application"
        tabIndex={0}
        aria-label={t('fit.area')}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
        // The photo is an <img>, and dragging an image is the browser's own
        // drag-and-drop: it cancels the pointer after the first step.
        onDragStart={(e) => e.preventDefault()}
        data-testid="fit-area"
        data-fit={`${draft.x},${draft.y},${draft.s}`}
        className="grid cursor-grab touch-none place-items-center rounded-[var(--radius-control)] bg-panel p-4 select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:cursor-grabbing"
      >
        <Face memberId={memberId} photo={photo} fitting={draft} size={FACE} />
      </div>
      <label className="grid gap-1 text-base text-muted">
        {t('fit.size')}
        <input
          type="range"
          min={FIT_LIMITS.sMin}
          max={FIT_LIMITS.sMax}
          step={0.02}
          value={draft.s}
          onChange={(e) => place({ ...draft, s: Number(e.target.value) })}
          data-testid="fit-size"
          className="w-full accent-[var(--accent)]"
        />
      </label>
      {failed ? (
        <p className="m-0 text-base text-danger" role="alert">
          {t('fit.failed')}
        </p>
      ) : null}
      {/* Allowed to wrap: a button never does, and "Remets-les au milieu"
          beside "Enregistre" hung fifty pixels past a thirteen-rem popover. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button look="quiet" size="sm" disabled={busy} onClick={() => setDraft(MIDDLE)}>
          {t('fit.reset')}
        </Button>
        <Button
          look="primary"
          size="sm"
          disabled={busy}
          onClick={() => void save()}
          data-testid="fit-save"
        >
          {t('fit.save')}
        </Button>
      </div>
    </div>
  );
}
