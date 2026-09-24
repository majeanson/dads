import type { GlassesKind } from '../shared/protocol';
import { GlassesPicker } from './GlassesPicker';
import { Check, Trash2, UserRound } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { clearMyFace, setMyFace, setMyName } from './api';
import { Face } from './Face';
import { useT } from './i18n';
import { prepareFace } from './media';
import { Button } from './ui/Button';
import { FIELD } from './ui/field';

/**
 * Who a dad is here: the name he goes by, and his face.
 *
 * Both were unchangeable. The name was settable once at the door and the only
 * way to change it was to sign out and rejoin, which in this app means
 * arriving as a stranger with none of your history.
 *
 * The face is cropped and shrunk here rather than on the way in, because the
 * browser is where the twelve-megapixel original already is and the server
 * has no business receiving it.
 */
export function You({
  memberId,
  name,
  face,
  glasses,
}: {
  memberId: string;
  name: string;
  /** The version of his face from the roster, or undefined for none. */
  face: number | undefined;
  /** The pair he wears, from the room's members. */
  glasses?: GlassesKind;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Shown the moment he picks one, so the face changes with the tap rather
   * than after a round trip through R2. */
  const [preview, setPreview] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  async function rename(event: FormEvent) {
    event.preventDefault();
    const next = draft.trim();
    if (!next || next === name) return;
    setBusy(true);
    setError(null);
    try {
      await setMyName(next);
    } catch {
      setError(t('you.failed'));
      setDraft(name);
    } finally {
      setBusy(false);
    }
  }

  async function pick(file: File | undefined) {
    if (file === undefined) return;
    setError(null);
    const square = await prepareFace(file);
    if (square === null) {
      // No fallback to the original, on purpose: a face the browser cannot
      // decode is a face this app cannot show either.
      setError(t('you.bad_image'));
      return;
    }
    setBusy(true);
    try {
      await setMyFace(square);
      // The handle before it goes, or every face he tries leaks a 320-square
      // JPEG for the life of the page — the same thing the composer's own
      // preview already takes care of.
      setPreview((was) => {
        if (was !== null) URL.revokeObjectURL(was);
        return URL.createObjectURL(square);
      });
    } catch {
      setError(t('you.failed'));
    } finally {
      setBusy(false);
      if (picker.current !== null) picker.current.value = '';
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await clearMyFace();
      setPreview((was) => {
        if (was !== null) URL.revokeObjectURL(was);
        return null;
      });
    } catch {
      setError(t('you.failed'));
    } finally {
      setBusy(false);
    }
  }

  const hasFace = preview !== null || face !== undefined;

  return (
    <div className="grid gap-3" data-testid="you">
      {/* The face and the name on one row: they are the two things that say
          who he is, and stacked with a label each they were a third of the
          settings screen on a phone. */}
      <form onSubmit={(e) => void rename(e)} className="flex items-center gap-3">
        {preview === null ? (
          <Face memberId={memberId} name={name} version={face} glasses={glasses} size={56} />
        ) : (
          <img
            src={preview}
            alt=""
            aria-hidden="true"
            width={56}
            height={56}
            className="inline-block h-14 w-14 shrink-0 rounded-full object-cover"
          />
        )}
        <label htmlFor="myname" className="sr-only">
          {t('you.name')}
        </label>
        <input
          id="myname"
          className={`${FIELD} min-w-0 flex-1`}
          value={draft}
          maxLength={32}
          placeholder={t('you.name')}
          autoComplete="given-name"
          autoCapitalize="words"
          enterKeyHint="done"
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          data-testid="my-name"
        />
        {/* Only once there is something to save. A permanently greyed-out
            button beside a field he is not editing is a control that spends
            a row of the screen saying nothing. */}
        {draft.trim() !== '' && draft.trim() !== name ? (
          <Button type="submit" look="primary" size="lg" className="shrink-0" disabled={busy}>
            <Check size={18} aria-hidden="true" />
            {t('you.save')}
          </Button>
        ) : null}
      </form>

      <div>
        <div className="flex flex-wrap gap-2">
          {/* A label, not a button wrapping an input: the file picker is the
              input, and a label with a real box is what a thumb presses. */}
          <label
            htmlFor="face"
            className={[
              // The same shape as a Button, because it sits beside one.
              'inline-flex h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-4',
              'border border-edge text-[1.0625rem] font-medium transition-colors duration-75',
              'hover:border-accent hover:text-accent',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
              'has-[:focus-visible]:outline-accent',
            ].join(' ')}
          >
            <UserRound size={18} aria-hidden="true" />
            {hasFace ? t('you.change_face') : t('you.add_face')}
          </label>
          <input
            ref={picker}
            id="face"
            className="sr-only"
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(e) => void pick(e.target.files?.[0])}
            data-testid="face-input"
          />

          {/* Quiet, not danger: taking off a picture you can put back in ten
              seconds is not the same act as taking back something you said,
              and two red buttons in one app teaches nobody anything. */}
          <GlassesPicker worn={glasses} />

          {hasFace ? (
            <Button look="quiet" disabled={busy} onClick={() => void remove()}>
              <Trash2 size={18} aria-hidden="true" />
              {t('you.remove_face')}
            </Button>
          ) : null}
        </div>
      </div>

      {error === null ? null : (
        <p className="text-[1.0625rem] text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
