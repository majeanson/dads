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

/**
 * What this device chose; failing that, the language of the invite he
 * followed (the Worker marks the page with the sender's); failing that, what
 * the browser is set to. A friend sent a French link lands on a French door
 * whatever his phone says, and the toggle is still in the corner.
 */
export function preferredLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE);
    if (saved === 'en' || saved === 'fr') return saved;
  } catch {
    // A browser that refuses storage still gets a language.
  }
  const invited = document.documentElement.dataset.inviteLang;
  if (invited === 'en' || invited === 'fr') {
    // Kept, as if he had pressed it: the hint is on this one page, and the
    // next load of the app would otherwise go back to the phone's language.
    try {
      localStorage.setItem(STORAGE, invited);
    } catch {
      // Not remembered; this load still speaks it.
    }
    return invited;
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
