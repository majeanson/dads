import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { translator, type Lang, type T } from '../shared/dictionary';

export {
  nightWhen,
  plural,
  translator,
  weekdayNames,
  type Key,
  type Lang,
  type T,
} from '../shared/dictionary';

const STORAGE = 'dads.lang';

/** What the browser is set to, unless this device has already chosen. */
export function preferredLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE);
    if (saved === 'en' || saved === 'fr') return saved;
  } catch {
    // A browser that refuses storage still gets a language.
  }
  const wanted = navigator.languages ?? [navigator.language];
  return wanted.some((l) => l?.toLowerCase().startsWith('fr')) ? 'fr' : 'en';
}

interface Ctx {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: T;
}

const LangContext = createContext<Ctx>({ lang: 'en', setLang: () => {}, t: translator('en') });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => preferredLang());

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE, next);
    } catch {
      // Remembering is a convenience, not a requirement.
    }
  }, []);

  return (
    <LangContext.Provider value={{ lang, setLang, t: translator(lang) }}>
      {children}
    </LangContext.Provider>
  );
}

export function useT(): Ctx {
  return useContext(LangContext);
}

/**
 * A question, in the language being read.
 *
 * The curated hundred carry both. One a dad wrote himself carries only what he
 * typed, and that is what everybody sees — his words, whichever language they
 * came in.
 */
export function promptText(lang: Lang, prompt: { body: string; bodyFr?: string | null }): string {
  return lang === 'fr' ? (prompt.bodyFr ?? prompt.body) : prompt.body;
}
