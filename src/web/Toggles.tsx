import { useT, type Lang } from './i18n';
import { useTheme, type Theme } from './theme';

/**
 * Language and theme, as two rows of small buttons.
 *
 * Not selects, not switches, not a settings screen: four things a dad might
 * ever change, all visible at once, and the one that is on shows it. The
 * glyphs carry the meaning for the theme — a sun, a moon, a phone — and each
 * has its words underneath for anything that reads the page aloud.
 */
export function Toggles() {
  const { lang, setLang, t } = useT();
  const [theme, setTheme] = useTheme();

  const langs: { id: Lang; label: string }[] = [
    { id: 'en', label: 'EN' },
    { id: 'fr', label: 'FR' },
  ];

  const themes: { id: Theme; glyph: string; label: string }[] = [
    { id: 'system', glyph: '▣', label: t('theme.system') },
    { id: 'light', glyph: '☀', label: t('theme.light') },
    { id: 'dark', glyph: '☾', label: t('theme.dark') },
  ];

  return (
    <div className="toggles">
      <div className="toggle" role="group" aria-label={t('menu.language')}>
        {langs.map((l) => (
          <button
            key={l.id}
            type="button"
            aria-pressed={lang === l.id}
            onClick={() => setLang(l.id)}
          >
            {l.label}
          </button>
        ))}
      </div>

      <div className="toggle" role="group" aria-label={t('menu.theme')}>
        {themes.map((th) => (
          <button
            key={th.id}
            type="button"
            aria-pressed={theme === th.id}
            onClick={() => setTheme(th.id)}
            title={th.label}
          >
            <span aria-hidden="true">{th.glyph}</span>
            <span className="sr-only">{th.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
