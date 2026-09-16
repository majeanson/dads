import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react';
import { Mic, Pencil, Plus, Reply, SendHorizontal, Square, X } from 'lucide-react';
import { useT } from './i18n';
import { isImage, prepare, readableSize, upload, type Prepared } from './media';
import { canRecord, clockOf, useRecorder } from './recorder';
import { Button } from './ui/Button';
import { cn } from './ui/cn';
import { EmojiPicker } from './ui/EmojiPicker';

export interface ComposerHandle {
  /** A file the room was handed — dropped on the page, or pasted. */
  offer: (file: File | undefined) => void;
  /** Put the caret in the field: he chose Reply or Edit on a line. */
  focus: () => void;
}

/**
 * Where a dad says something.
 *
 * A voice note is the POINT of this row, not a corner of it: a man with a
 * child on his hip does not type a paragraph, and the thing he wanted to say
 * goes unsaid. With nothing typed the composer offers the microphone; the
 * moment he types a letter it offers Send. Never both — four controls on a
 * phone row is three.
 *
 * It stays live while the socket is down. Taking the keyboard off a man
 * because the network went is the app making its problem his.
 */
export function Composer({
  ref,
  busy,
  onSend,
  onTyping,
  replyTo = null,
  onClearReply,
  editing = null,
  onEdit,
  onCancelEdit,
}: {
  ref?: RefObject<ComposerHandle | null>;
  /**
   * His hands are full — a line half typed, a photo chosen, an upload going,
   * a recording running. None of these survive a reload, so a new build waits.
   *
   * A ref written during render rather than a callback into the room's state:
   * it is read at the instant he comes back to the app and never rendered, so
   * a state change would have cost a render for nothing — and the frame that
   * took was a reload landing on the line he had just sent.
   */
  busy?: RefObject<boolean>;
  onSend: (body: string, mediaId?: string) => void;
  onTyping: () => void;
  /** The line he is answering, shown above the field until he sends or clears it. */
  replyTo?: { name: string; body: string } | null;
  onClearReply?: () => void;
  /** The line he is changing: the field holds its words, Send means "change". */
  editing?: { id: string; body: string } | null;
  /** False when the room could not be reached; the draft stays. */
  onEdit?: (id: string, body: string) => boolean;
  onCancelEdit?: () => void;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState('');
  /** Picked but not sent: the dad still gets a caption, or a change of mind. */
  const [pending, setPending] = useState<Prepared | null>(null);
  /** A thumbnail of it, while it is still his to take back. */
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const recorder = useRecorder();
  const picker = useRef<HTMLInputElement>(null);
  const say = useRef<HTMLInputElement>(null);

  const recording = recorder.state.kind === 'recording' || recorder.state.kind === 'asking';
  if (busy) busy.current = draft.trim() !== '' || pending !== null || sending || recording;

  // Editing takes the field: his words go in, and what he was typing waits
  // in the outbox of his own head. Cancelling gives the field back empty.
  const editingId = editing?.id ?? null;
  useEffect(() => {
    if (editing) {
      setDraft(editing.body);
      setPending(null);
    } else setDraft('');
    // Only when WHICH line changes, not on every render of the same one.
  }, [editingId]);

  function cancelContext() {
    if (editing) onCancelEdit?.();
    else if (replyTo) onClearReply?.();
  }

  async function pick(file: File | undefined) {
    setUploadError(null);
    if (file === undefined) return;
    setPending(await prepare(file));
  }

  useImperativeHandle(
    ref,
    () => ({ offer: (file) => void pick(file), focus: () => say.current?.focus() }),
    [],
  );

  /**
   * The thumbnail, made and unmade with what it shows.
   *
   * An object URL is a handle the browser holds until it is revoked, so every
   * one has to be given back — a dad who changes his mind four times should
   * not be leaking four photographs' worth of memory into his phone.
   */
  useEffect(() => {
    if (pending === null || !isImage(pending.blob.type)) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(pending.blob);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [pending]);

  /**
   * Send whatever was uploaded, or say why it did not go.
   *
   * try/finally, because `upload` does not always return: fetch REJECTS on a
   * network failure rather than answering, which is the wifi-to-LTE hop this
   * whole app is built around. Without it `sending` stayed true, and `sending`
   * disables the Send button, the microphone and the file picker alike — a dad
   * left with a composer he could not use and nothing on the screen saying
   * why, until he reloaded.
   */
  async function put(what: Prepared): Promise<string | null> {
    setSending(true);
    setUploadError(null);
    let result: Awaited<ReturnType<typeof upload>>;
    try {
      result = await upload(what);
    } catch {
      result = { ok: false, error: 'unknown' };
    } finally {
      setSending(false);
    }
    if (result.ok) return result.media.id;
    setUploadError(
      result.error === 'too_large' ? t('composer.too_large') : t('composer.upload_failed'),
    );
    return null;
  }

  /** Into the field where the caret is, and the caret after it. */
  function insert(emoji: string) {
    const field = say.current;
    const at = field?.selectionStart ?? draft.length;
    const to = field?.selectionEnd ?? at;
    const next = draft.slice(0, at) + emoji + draft.slice(to);
    setDraft(next);
    onTyping();
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(at + emoji.length, at + emoji.length);
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();

    // Changing a line: the same Send, a different verb. Not optimistic — the
    // field clears only once the room took it, and stays if it could not.
    if (editing) {
      if (!body || body === editing.body.trim()) return;
      if (onEdit?.(editing.id, body)) {
        onCancelEdit?.();
        say.current?.focus();
      }
      return;
    }

    // A photo with no caption is still something said.
    if (!body && pending === null) return;

    if (pending === null) {
      onSend(body);
      setDraft('');
      // The keyboard stays up: he said one thing, he is probably saying
      // another. Blurring here would drop it after every line on a phone.
      say.current?.focus();
      return;
    }

    const mediaId = await put(pending);
    if (mediaId === null) return;
    onSend(body, mediaId);
    setDraft('');
    setPending(null);
    if (picker.current !== null) picker.current.value = '';
    say.current?.focus();
  }

  /**
   * The thing he just said, straight into the room.
   *
   * No caption and no preview: a voice note that has to be confirmed is one
   * more step between a man with a child on his hip and the thing he wanted
   * to say, which is the entire reason this exists.
   */
  async function sendVoice() {
    const spoken = await recorder.stop();
    if (spoken === null) return;
    const mediaId = await put(spoken);
    if (mediaId !== null) onSend('', mediaId);
  }

  return (
    <form
      className="composer rounded-xl border border-line bg-panel p-1.5 shadow-sm"
      onSubmit={submit}
      onPaste={(event) => {
        const file = event.clipboardData.files[0];
        if (file === undefined) return;
        event.preventDefault();
        void pick(file);
      }}
    >
      {/* What this line is: an answer to somebody, or a change to his own.
          One strip above the field with a way out, and Escape in the field is
          the same way out. */}
      {editing || replyTo ? (
        <p className="context" data-testid={editing ? 'editing' : 'replying'}>
          {editing ? (
            <Pencil size={14} aria-hidden="true" className="shrink-0 text-muted" />
          ) : (
            <Reply size={14} aria-hidden="true" className="shrink-0 text-muted" />
          )}
          <span className="context-what">
            {editing ? (
              t('composer.editing')
            ) : (
              <>
                <span className="text-muted">
                  {t('composer.replying', { name: replyTo!.name })}
                </span>{' '}
                {replyTo!.body}
              </>
            )}
          </span>
          <Button
            look="quiet"
            size="iconSm"
            className="rounded-full"
            aria-label={t('composer.clear')}
            onClick={cancelContext}
            data-testid="context-clear"
          >
            <X size={14} aria-hidden="true" />
            <span className="sr-only">{t('composer.clear')}</span>
          </Button>
        </p>
      ) : null}

      {pending !== null ? (
        <p className="pending" data-testid="pending-media">
          {preview === null ? null : <img src={preview} alt="" />}
          <span className="pending-what">
            {pending.name} <span className="quiet">{readableSize(pending.blob.size)}</span>
          </span>
          <Button
            look="danger"
            size="iconSm"
            className="rounded-full"
            aria-label={t('composer.remove')}
            onClick={() => {
              setPending(null);
              if (picker.current !== null) picker.current.value = '';
            }}
          >
            <X size={14} aria-hidden="true" />
            <span className="sr-only">{t('composer.remove')}</span>
          </Button>
        </p>
      ) : null}

      {uploadError !== null || recorder.state.kind === 'denied' ? (
        <p className="error" role="alert">
          {uploadError ?? t('composer.mic_denied')}
        </p>
      ) : null}

      {/* Recording takes the whole row: a red dot, how long he has been
          talking, and the two things he can do about it. Nothing else on the
          row can be pressed by accident while he is speaking. */}
      {recording ? (
        <>
          <span
            className="flex min-w-0 flex-1 items-center gap-2 px-1 text-[0.9375rem]"
            aria-live="polite"
            data-testid="recording"
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-danger" aria-hidden="true" />
            <span className="tabular-nums">
              {recorder.state.kind === 'recording' ? clockOf(recorder.state.ms) : '0:00'}
            </span>
            <span className="truncate text-muted">{t('composer.recording')}</span>
          </span>
          <Button
            look="danger"
            size="icon"
            className="h-11 w-11"
            aria-label={t('composer.cancel')}
            onClick={recorder.cancel}
          >
            <X size={18} aria-hidden="true" />
            <span className="sr-only">{t('composer.cancel')}</span>
          </Button>
          <Button
            look="primary"
            size="icon"
            className="h-11 w-11"
            aria-label={t('composer.send')}
            disabled={sending}
            onClick={() => void sendVoice()}
          >
            <Square size={16} aria-hidden="true" />
            <span className="sr-only">{t('composer.send')}</span>
          </Button>
        </>
      ) : (
        <>
          <label
            htmlFor="attach"
            className={cn(
              'grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-app',
              'border border-edge text-muted transition-colors duration-75',
              'hover:border-accent hover:text-accent',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
            )}
          >
            <Plus size={18} aria-hidden="true" />
            <span className="sr-only">{t('composer.attach')}</span>
          </label>
          <input
            ref={picker}
            id="attach"
            className="sr-only"
            type="file"
            onChange={(e) => void pick(e.target.files?.[0])}
            // Not gated on the socket. Choosing a photo is not saying
            // anything yet, the upload is plain HTTP and does not need the
            // websocket, and the line waits in the outbox like any other — so
            // a dad on a wifi-to-LTE hop kept a composer whose `+` did
            // nothing at all, with no disabled look on the label to say why.
            // And not while changing a line: an edit is words only.
            disabled={sending || editing !== null}
          />

          <label htmlFor="say" className="sr-only">
            {t('composer.say')}
          </label>
          {/* The field and the emoji button share the middle cell, so the row
              is still three controls wide: the button only exists where there
              is a mouse, and a phone's keyboard is its own picker. */}
          <div className="flex min-w-0 items-center">
            <input
              ref={say}
              id="say"
              // 16px: anything smaller and iOS zooms the page in when he taps
              // the field, and does not zoom it back out.
              className="h-11 min-w-0 flex-1 rounded-lg border-0 bg-transparent px-2 text-base text-ink placeholder:text-muted/70 focus:outline-none"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                onTyping();
              }}
              placeholder={pending === null ? t('composer.say') : t('composer.caption')}
              autoComplete="off"
              autoCapitalize="sentences"
              // The keyboard's own return key says what it does here.
              enterKeyHint="send"
              onKeyDown={(e) => {
                if (e.key === 'Escape' && (editing || replyTo)) {
                  e.preventDefault();
                  cancelContext();
                }
              }}
            />
            <EmojiPicker onPick={insert} className="hidden shrink-0 pointer-fine:inline-flex" />
          </div>
          {/* One or the other, never both: with nothing typed the room is
              asking him to speak, and the moment he types a letter it is
              asking him to send. Four controls on a phone row is three. */}
          {draft.trim() === '' && pending === null && !editing && canRecord() ? (
            <Button
              look="plain"
              size="icon"
              className="h-11 w-11"
              aria-label={t('composer.record')}
              disabled={sending}
              onClick={() => void recorder.start()}
              data-testid="record"
            >
              <Mic size={18} aria-hidden="true" />
              <span className="sr-only">{t('composer.record')}</span>
            </Button>
          ) : (
            <Button
              type="submit"
              look="primary"
              size="icon"
              className="h-11 w-11"
              aria-label={t('composer.send')}
              disabled={
                sending ||
                (!draft.trim() && pending === null) ||
                (editing !== null && editing !== undefined && draft.trim() === editing.body.trim())
              }
              // Pressing Send must not take focus off the field: on a phone
              // that is the keyboard folding away after every line, and on
              // iOS it is the composer jumping too.
              onMouseDown={(e) => e.preventDefault()}
            >
              <SendHorizontal size={18} aria-hidden="true" />
              <span className="sr-only">
                {sending ? t('composer.sending') : t('composer.send')}
              </span>
            </Button>
          )}
        </>
      )}
    </form>
  );
}
