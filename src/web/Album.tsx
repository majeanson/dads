import { Pin } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchAlbum, type Held } from './api';
import { useT } from './i18n';
import { mediaUrl } from './media';
import { useNameOf } from './members';
import { Viewer, type Shown } from './Viewer';

type State = { status: 'looking' } | { status: 'failed' } | { status: 'ready'; held: Held[] };

/**
 * Every picture the room still holds.
 *
 * The conversation is where a photograph is posted and the only other place it
 * can be looked at is further up it, and a room's shelf is forty pictures
 * deep. This is the shelf as a grid, newest first, with the kept ones pinned,
 * and a tap opens the same viewer the conversation uses — so a swipe walks the
 * whole shelf, not the pictures that happen to be in the five hundred lines.
 *
 * It has no controls of its own. Keeping and letting go are done where the
 * picture is, in the conversation, where the room says so to everybody.
 */
export function Album() {
  const { t, lang } = useT();
  const nameOf = useNameOf();
  const [state, setState] = useState<State>({ status: 'looking' });
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchAlbum().then(
      (held) => live && setState({ status: 'ready', held }),
      () => live && setState({ status: 'failed' }),
    );
    return () => {
      live = false;
    };
  }, []);

  const shots: Shown[] = useMemo(
    () =>
      state.status !== 'ready'
        ? []
        : state.held.map((m) => ({
            media: {
              id: m.id,
              name: m.name,
              contentType: m.contentType,
              width: m.width,
              height: m.height,
              kept: m.kept,
            },
            name: nameOf(m.memberId),
            at: m.createdAt,
          })),
    // `nameOf` is new every render and only reads a map that changes with the room.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state],
  );
  const at = open === null ? -1 : shots.findIndex((s) => s.media.id === open);
  const locale = lang === 'fr' ? 'fr-CA' : 'en-CA';

  if (state.status === 'looking') return <p className="quiet m-0">…</p>;
  if (state.status === 'failed') {
    return (
      <p className="error m-0" role="alert">
        {t('album.failed')}
      </p>
    );
  }
  if (shots.length === 0) return <p className="quiet m-0">{t('album.empty')}</p>;

  return (
    <div className="grid gap-3" data-testid="album">
      <p className="m-0 text-base text-muted">{t('album.lede')}</p>
      <ul className="m-0 grid list-none grid-cols-3 gap-1.5 p-0">
        {shots.map((s) => {
          const when = new Date(s.at).toLocaleDateString(locale, {
            day: 'numeric',
            month: 'short',
          });
          return (
            <li key={s.media.id} className="relative">
              <button
                type="button"
                className="block aspect-square w-full cursor-pointer overflow-hidden rounded-[var(--radius-control)] border border-line bg-soft p-0"
                onClick={() => setOpen(s.media.id)}
                aria-label={t('album.of', { name: s.name, when })}
                data-testid="album-shot"
              >
                <img
                  src={mediaUrl(s.media.id)}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover"
                />
              </button>
              {s.media.kept ? (
                <span
                  className="pointer-events-none absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-black/60 text-white"
                  data-testid="album-kept"
                >
                  <Pin size={13} aria-hidden="true" />
                  <span className="sr-only">{t('line.kept')}</span>
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Viewer
        shots={shots}
        at={at}
        onMove={(next) => setOpen(shots[next]?.media.id ?? null)}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}
