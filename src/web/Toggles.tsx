import { Moon, Sun, SunMoon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT, type Lang } from './i18n';
import { Button } from './ui/Button';
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
export function LangToggle() {
  const { lang, setLang, t } = useT();
  return (
    <div className="flex gap-1.5" role="group" aria-label={t('menu.language')}>
      {LANGS.map((l) => (
        <Button
          key={l.id}
          size="icon"
          className={lang === l.id ? 'border-accent text-accent' : 'text-muted'}
          aria-pressed={lang === l.id}
          onClick={() => setLang(l.id)}
        >
          {l.label}
        </Button>
      ))}
    </div>
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
    <div className="flex min-h-16 items-center justify-between gap-3 border-b border-line py-2.5">
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
        <div className="flex gap-1.5" role="group" aria-label={t('menu.theme')}>
          {themes.map((th) => (
            <Button
              key={th.id}
              size="icon"
              aria-pressed={theme === th.id}
              onClick={() => setTheme(th.id)}
              title={th.label}
              className={theme === th.id ? 'border-accent text-accent' : 'text-muted'}
            >
              <th.Icon size={20} aria-hidden="true" />
              <span className="sr-only">{th.label}</span>
            </Button>
          ))}
        </div>
      </Row>
    </>
  );
}
