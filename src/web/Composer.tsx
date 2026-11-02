import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react';
import { Mic, Pencil, Plus, Reply, SendHorizontal, Square, X } from 'lucide-react';
import { matching, mentionAt, tagged } from '../shared/mentions';
import { deviceStorage, readDraft, writeDraft } from './drafts';
import { Face } from './Face';
import { useT } from './i18n';
import { Quote } from './Lines';
import { useMembers } from './members';
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
  /** Put the keyboard away: he tapped the conversation to read it. */
  blur: () => void;
}

/** The field grows with what he types up to this many lines, then scrolls. */
const MAX_LINES = 5;
/** How long typing has to pause before the draft is written down. */
const DRAFT_MS = 300;

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
  groupId,
  me,
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
  /** The room, whose half-typed line this phone keeps (`drafts.ts`). */
  groupId: string;
  /** His own member id: a man does not tag himself. */
  me: string;
  onSend: (body: string, mediaId?: string) => void;
  onTyping: () => void;
  /** The line he is answering, shown above the field until he sends or clears it. */
  replyTo?: { name: string; body: string } | null;
  onClearReply?: () => void;
  /** The line he is changing: the field holds its words, Send means "change". */
  editing?: { id: string; body: string } | null;
  /** False when the room never took it; his words stay in the field. */
  onEdit?: (id: string, body: string) => Promise<boolean>;
  onCancelEdit?: () => void;
}) {
  const { t } = useT();
  // What he had half typed here before a reload or a look into another room
  // (Marc asked, 2026-11-01).
  const [draft, setDraft] = useState(() => readDraft(deviceStorage(), groupId));
  /** Picked but not sent: the dad still gets a caption, or a change of mind. */
  const [pending, setPending] = useState<Prepared | null>(null);
  /** A thumbnail of it, while it is still his to take back. */
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const recorder = useRecorder();
  const picker = useRef<HTMLInputElement>(null);
  const say = useRef<HTMLTextAreaElement>(null);
  /**
   * The draft waiting to be written down: one write per pause in his typing,
   * not one per letter. Flushed when an edit takes the field and when the
   * composer goes, so the last few letters are never the ones lost.
   */
  const unwritten = useRef<{ timer: ReturnType<typeof setTimeout>; text: string } | null>(null);
  /**
   * Which edit is the one on the screen now. An edit waits up to
   * ACK_GRACE_MS for its line, and meanwhile he can press X and pick Edit on
   * another line, or the same one again. The answer to the first must not
   * clear the second's words or tell the second it failed: each send takes a
   * number, and only the newest one's answer is his to hear.
   */
  const editSeq = useRef(0);
  /** The send that holds `sending`, so a stale answer still lets go of the
   * button unless a newer edit has taken it. */
  const sendingFor = useRef(0);

  const recording = recorder.state.kind === 'recording' || recorder.state.kind === 'asking';
  if (busy) busy.current = draft.trim() !== '' || pending !== null || sending || recording;

  function flushDraft() {
    const waiting = unwritten.current;
    if (waiting === null) return;
    clearTimeout(waiting.timer);
    unwritten.current = null;
    writeDraft(deviceStorage(), groupId, waiting.text);
  }

  /**
   * The field changed because HE changed it: typing, a name picked, an
   * emoji. Only these are his draft. An edit's words are the line's, not
   * his, so they are never written down over what he was typing.
   */
  function change(next: string) {
    setDraft(next);
    if (editing) return;
    if (unwritten.current !== null) clearTimeout(unwritten.current.timer);
    unwritten.current = { text: next, timer: setTimeout(flushDraft, DRAFT_MS) };
  }

  /** Sent: nothing is half typed any more, and that is written at once. */
  function forgetDraft() {
    if (unwritten.current !== null) clearTimeout(unwritten.current.timer);
    unwritten.current = null;
    writeDraft(deviceStorage(), groupId, '');
  }

  // Going (sign out, a room left): the last letters are written down.
  useEffect(
    () => () => {
      const waiting = unwritten.current;
      if (waiting === null) return;
      clearTimeout(waiting.timer);
      writeDraft(deviceStorage(), groupId, waiting.text);
    },
    [groupId],
  );

  // Editing takes the field: his words go in, and what he was typing waits,
  // written down. When the edit ends, sent or cancelled, the field gives his
  // draft back rather than an empty field.
  const editingId = editing?.id ?? null;
  useEffect(() => {
    // A different line (or none) is a different edit: whatever the last one
    // is still waiting to hear is no longer about the field.
    editSeq.current++;
    if (editing) {
      flushDraft();
      setDraft(editing.body);
      setPending(null);
    } else setDraft(readDraft(deviceStorage(), groupId));
    // Only when WHICH line changes, not on every render of the same one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  /**
   * The field grows with his words, one line to MAX_LINES, then scrolls
   * (Marc chose this, 2026-11-01). Measured rather than left to
   * `field-sizing: content`, which Safari does not have. Height to auto
   * first, so it shrinks again once the line has gone. Again after a
   * recording, which takes the field off the row and puts a new one back.
   */
  useLayoutEffect(() => {
    const field = say.current;
    if (field === null) return;
    const style = getComputedStyle(field);
    const line = parseFloat(style.lineHeight) || 24;
    const cap =
      line * MAX_LINES +
      (parseFloat(style.paddingTop) || 0) +
      (parseFloat(style.paddingBottom) || 0);
    field.style.height = 'auto';
    const wanted = field.scrollHeight;
    field.style.height = `${Math.min(wanted, cap)}px`;
    field.style.overflowY = wanted > cap ? 'auto' : 'hidden';
  }, [draft, recording]);

  function cancelContext() {
    if (editing) {
      editSeq.current++;
      onCancelEdit?.();
    } else if (replyTo) onClearReply?.();
  }

  /**
   * "@" and a name tags a dad (Marc, 2026-11-01).
   *
   * The dads whose name starts with what he has typed after the "@" are a
   * list above the field; a tap, Enter or Tab puts the name in, Escape puts
   * the list away for that "@". Nothing is sent but the text: "@Sam" is
   * found again by whoever reads it (`shared/mentions.ts`). The departed
   * are not offered and nor is he.
   */
  const people = useMembers()
    .filter((m) => m.gone !== true && m.memberId !== me)
    .map((m) => ({ id: m.memberId, name: m.name }));
  const [caret, setCaret] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  /** Which row the keys have moved to, for the "@" they moved it on. */
  const [moved, setMoved] = useState({ start: -1, query: '', to: 0 });
  const tagging = mentionAt(draft, caret);
  const picks = tagging === null ? [] : matching(tagging.query, people);
  const showPicks = tagging !== null && picks.length > 0 && dismissedAt !== tagging.start;
  const highlighted =
    tagging !== null && moved.start === tagging.start && moved.query === tagging.query
      ? Math.min(moved.to, picks.length - 1)
      : 0;
  const readCaret = (field: HTMLTextAreaElement) => setCaret(field.selectionStart ?? 0);
  function tag(name: string) {
    if (tagging === null) return;
    const { next, caret: to } = tagged(draft, tagging.start, caret, name);
    change(next);
    setCaret(to);
    onTyping();
    requestAnimationFrame(() => {
      say.current?.focus();
      say.current?.setSelectionRange(to, to);
    });
  }

  async function pick(file: File | undefined) {
    setUploadError(null);
    if (file === undefined) return;
    setPending(await prepare(file));
  }

  useImperativeHandle(
    ref,
    () => ({
      offer: (file) => void pick(file),
      focus: () => say.current?.focus(),
      blur: () => say.current?.blur(),
    }),
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
    change(next);
    onTyping();
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(at + emoji.length, at + emoji.length);
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    // Enter reaches here too, and Enter does not know the button is greyed.
    if (sending) return;
    const body = draft.trim();

    // Changing a line: the same Send, a different verb. Not optimistic — the
    // field clears only once the room has said it took it, and holds his words
    // if it did not. "Took it" means the line came back changed, never that
    // the send did not throw: a socket in a dead spot does not throw.
    if (editing) {
      if (!body || body === editing.body.trim()) return;
      setUploadError(null);
      setSending(true);
      const mine = ++editSeq.current;
      sendingFor.current = mine;
      try {
        const took = await onEdit?.(editing.id, body);
        if (mine !== editSeq.current) return;
        if (took) {
          onCancelEdit?.();
          say.current?.focus();
        } else {
          setUploadError(t('composer.edit_failed'));
        }
      } finally {
        // In a finally for the same reason the upload's is: the room going
        // quiet must not leave him holding a composer he cannot use.
        if (sendingFor.current === mine) setSending(false);
      }
      return;
    }

    // A photo with no caption is still something said.
    if (!body && pending === null) return;

    if (pending === null) {
      onSend(body);
      setDraft('');
      forgetDraft();
      // The keyboard stays up: he said one thing, he is probably saying
      // another. Blurring here would drop it after every line on a phone.
      say.current?.focus();
      return;
    }

    const mediaId = await put(pending);
    if (mediaId === null) return;
    onSend(body, mediaId);
    setDraft('');
    forgetDraft();
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
      className="composer rounded-[1.625rem] border border-line bg-panel p-1.5 shadow-sm"
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
          {/* A reply is the same card the answer will carry in the room,
              so what he sees here is what everybody will see above his words. */}
          {editing ? (
            <span className="context-what">{t('composer.editing')}</span>
          ) : (
            <span className="min-w-0 flex-1">
              <Quote reply={replyTo!} label={t('composer.replying', { name: replyTo!.name })} />
            </span>
          )}
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

      {showPicks ? (
        <ul
          id="tag-picks"
          className="tag-picks"
          role="listbox"
          aria-label={t('composer.tag')}
          data-testid="tag-picks"
        >
          {picks.map((p, i) => (
            <li key={p.id} role="presentation">
              <button
                type="button"
                role="option"
                id={`tag-pick-${p.id}`}
                aria-selected={i === highlighted}
                className={cn(
                  'flex h-11 w-full cursor-pointer items-center gap-3 rounded-app px-2 text-left text-base',
                  i === highlighted ? 'bg-panel' : 'hover:bg-panel',
                )}
                // The field keeps the keyboard: a tap here must not fold it.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => tag(p.name)}
              >
                <Face memberId={p.id} size={28} />
                <span className="min-w-0 truncate">{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
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
            className="h-11 w-11 rounded-full!"
            aria-label={t('composer.cancel')}
            onClick={recorder.cancel}
          >
            <X size={18} aria-hidden="true" />
            <span className="sr-only">{t('composer.cancel')}</span>
          </Button>
          <Button
            look="primary"
            size="icon"
            className="h-11 w-11 rounded-full!"
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
              'grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full',
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
              is a mouse, and a phone's keyboard is its own picker. Both sit
              at the bottom of the cell once the field has grown. */}
          <div className="flex min-w-0 items-end">
            <textarea
              ref={say}
              id="say"
              rows={1}
              // 16px: anything smaller and iOS zooms the page in when he taps
              // the field, and does not zoom it back out. One line is 44px
              // (24 of line and 10 above and below), the same as before it
              // could grow; the height past that is set from what he typed.
              className="block min-h-11 min-w-0 flex-1 resize-none rounded-lg border-0 bg-transparent px-2 py-2.5 text-base leading-6 text-ink placeholder:text-muted/70 focus:outline-none"
              value={draft}
              onChange={(e) => {
                change(e.target.value);
                readCaret(e.target);
                onTyping();
              }}
              onSelect={(e) => readCaret(e.currentTarget)}
              placeholder={pending === null ? t('composer.say') : t('composer.caption')}
              autoComplete="off"
              autoCapitalize="sentences"
              // The keyboard's own return key says what it does here.
              enterKeyHint="send"
              // A textarea is a textbox and may not be a combobox, and a
              // textbox may not say it is expanded. What it may say is that
              // a list completes it and which of its rows the keys are on.
              aria-autocomplete={showPicks ? 'list' : undefined}
              aria-controls={showPicks ? 'tag-picks' : undefined}
              aria-activedescendant={showPicks ? `tag-pick-${picks[highlighted]!.id}` : undefined}
              onKeyDown={(e) => {
                if (showPicks && tagging !== null) {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    const to =
                      (highlighted + (e.key === 'ArrowDown' ? 1 : -1) + picks.length) %
                      picks.length;
                    setMoved({ start: tagging.start, query: tagging.query, to });
                    return;
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    tag(picks[highlighted]!.name);
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setDismissedAt(tagging.start);
                    return;
                  }
                }
                if (e.key === 'Escape' && (editing || replyTo)) {
                  e.preventDefault();
                  cancelContext();
                  return;
                }
                // Enter sends, as it did when this was one line: a laptop's
                // Enter, and a phone keyboard's Send key, which arrives as
                // one. Shift+Enter is the new line. Not mid-composition: an
                // IME's Enter is choosing a word, not sending it.
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
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
              className="h-11 w-11 rounded-full!"
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
              className="h-11 w-11 rounded-full!"
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
