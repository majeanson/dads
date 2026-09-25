import { Moon, Sun, SunMoon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT, type Lang } from './i18n';
import { cn } from './ui/cn';
import { useTheme, type Theme } from './theme';

const LANGS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'EN' },
  { id: 'fr', label: 'FR' },
];

/**
 * Which of the two languages this dad reads.
 *
 * Its own component because the door needs it too: a francophone whose browser
 * says English met an English door and could not say otherwise until he was
 * already inside.
 */
export function LangToggle({ compact = false }: { compact?: boolean }) {
  const { lang, setLang, t } = useT();
  // At the door it is a small joined pair in the corner, out of the way of
  // the one question the door asks. The words are the same, so a test and a
  // screen reader still ask for "FR".
  if (compact) {
    return (
      <div
        className="inline-flex overflow-hidden rounded-app border border-edge"
        role="group"
        aria-label={t('menu.language')}
      >
        {LANGS.map((l) => (
          <button
            key={l.id}
            type="button"
            aria-pressed={lang === l.id}
            onClick={() => setLang(l.id)}
            className={
              'h-9 min-w-11 cursor-pointer px-2.5 text-sm font-semibold transition-colors duration-100 ' +
              (lang === l.id
                ? 'bg-accent text-on-accent'
                : 'bg-transparent text-muted hover:text-ink')
            }
          >
            {l.label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className={TRACK} role="group" aria-label={t('menu.language')}>
      {LANGS.map((l) => (
        <button
          key={l.id}
          type="button"
          className={segment(lang === l.id, 'text-base font-semibold')}
          aria-pressed={lang === l.id}
          onClick={() => setLang(l.id)}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A choice of a few, as one control: a track with the chosen segment filled (44px segments on a slim track, so a row is
 * no taller than the square buttons it replaced),
 * the shape home's three answers and the week's 1-5 already have. These were
 * loose square buttons with an outline for the chosen one, which made
 * Settings the one screen where picking one of three looked different.
 */
const TRACK =
  'inline-flex gap-0.5 rounded-[var(--radius-control)] border border-edge bg-paper p-0.5';
function segment(on: boolean, extra = ''): string {
  return cn(
    'grid h-11 min-w-11 cursor-pointer place-items-center rounded-[calc(var(--radius-control)-0.25rem)] px-2.5',
    'transition-colors duration-150',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    on ? 'bg-accent text-on-accent' : 'text-muted hover:text-ink',
    extra,
  );
}

/**
 * One row per question, named on the left and answered on the right.
 *
 * The same shape as a `Switch` row, because they sit in the same list and a
 * settings screen that answers three questions in three different shapes
 * makes a dad work out which is which. It also gives these two a visible
 * name: a bare row of EN / FR and three glyphs was a group label only a
 * screen reader ever heard.
 */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    // The same 64px and the same size of word as a Switch row: these sit in
    // one list with those, and a list that answers three questions in two
    // sizes makes a dad work out which is which.
    <div className="flex min-h-[clamp(2.75rem,6dvh,4rem)] items-center justify-between gap-3 border-b border-line py-1.5">
      <span className="text-[1.125rem] text-muted">{label}</span>
      {children}
    </div>
  );
}

export function Toggles() {
  const { t } = useT();
  const [theme, setTheme] = useTheme();

  const themes: { id: Theme; Icon: typeof Sun; label: string }[] = [
    { id: 'system', Icon: SunMoon, label: t('theme.system') },
    { id: 'light', Icon: Sun, label: t('theme.light') },
    { id: 'dark', Icon: Moon, label: t('theme.dark') },
  ];

  return (
    <>
      <Row label={t('menu.language')}>
        <LangToggle />
      </Row>
      <Row label={t('menu.theme')}>
        {/* The glyphs carry the meaning — a sun, a moon, a phone — and each
            has its words underneath for anything reading the page aloud. */}
        <div className={TRACK} role="group" aria-label={t('menu.theme')}>
          {themes.map((th) => (
            <button
              key={th.id}
              type="button"
              aria-pressed={theme === th.id}
              onClick={() => setTheme(th.id)}
              title={th.label}
              className={segment(theme === th.id)}
            >
              <th.Icon size={20} aria-hidden="true" />
              <span className="sr-only">{th.label}</span>
            </button>
          ))}
        </div>
      </Row>
    </>
  );
}
