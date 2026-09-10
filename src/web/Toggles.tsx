import { Moon, Sun, SunMoon } from 'lucide-react';
import { useT, type Lang } from './i18n';
import { Button } from './ui/Button';
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
export function LangToggle() {
  const { lang, setLang, t } = useT();
  return (
    <div className="flex gap-1.5" role="group" aria-label={t('menu.language')}>
      {LANGS.map((l) => (
        <Button
          key={l.id}
          size="icon"
          className={cn('w-11', lang === l.id ? 'border-accent text-accent' : 'text-muted')}
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
 * Language and theme, as two rows of small buttons.
 *
 * Not selects, not switches, not a settings screen: four things a dad might
 * ever change, all visible at once, and the one that is on shows it. The
 * glyphs carry the meaning for the theme — a sun, a moon, a phone — and each
 * has its words underneath for anything that reads the page aloud.
 */
export function Toggles() {
  const { t } = useT();
  const [theme, setTheme] = useTheme();

  const themes: { id: Theme; Icon: typeof Sun; label: string }[] = [
    { id: 'system', Icon: SunMoon, label: t('theme.system') },
    { id: 'light', Icon: Sun, label: t('theme.light') },
    { id: 'dark', Icon: Moon, label: t('theme.dark') },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <LangToggle />

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
            <th.Icon size={16} aria-hidden="true" />
            <span className="sr-only">{th.label}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
