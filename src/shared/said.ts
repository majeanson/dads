import { plural, nightWhen, translator, type Lang, type T } from './dictionary';
import type { DadNight } from './dadNight';

/**
 * The lines the room says about itself, as facts rather than as sentences.
 *
 * A dad said "rough bedtime tonight", and that is his, in his words, forever.
 * But "Marc set dad night to Thursdays at 21:00" is the ROOM talking, and the
 * room talks to each dad in his own language — which it cannot do if what was
 * archived is an English sentence.
 *
 * So the archive keeps both. `body` is the English: what anyone reading D1 by
 * hand sees, and what still renders if this shape ever fails to parse. `meta`
 * is what actually happened. When a line carries meta the reader's own
 * language wins; when it does not — every row written before this existed —
 * the English body stands, which is exactly the right outcome for them.
 */
export type Said =
  | { k: 'night_set'; by: string; weekday: number; time: string }
  | { k: 'night_cleared'; by: string }
  | { k: 'night_open' }
  | { k: 'night_done'; dads: number; lines: number }
  | { k: 'rsvp'; name: string; coming: boolean }
  | { k: 'check_in'; name: string; rating: number; note: string }
  | { k: 'commitment'; name: string; body: string }
  | { k: 'outcome'; name: string; body: string; note: string; done: boolean }
  | { k: 'table_seated'; name: string }
  | { k: 'table_left'; name: string }
  | { k: 'table_started' }
  | { k: 'table_over'; summary: string };

/** Nothing is trusted off the wire or out of the archive. */
export function parseSaid(raw: unknown): Said | null {
  if (typeof raw !== 'string') return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;

  const said = value as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  switch (said.k) {
    case 'night_set': {
      const by = str(said.by);
      const weekday = num(said.weekday);
      const time = str(said.time);
      return by && weekday !== null && time ? { k: 'night_set', by, weekday, time } : null;
    }
    case 'night_cleared': {
      const by = str(said.by);
      return by ? { k: 'night_cleared', by } : null;
    }
    case 'night_open':
      return { k: 'night_open' };
    case 'rsvp': {
      const name = str(said.name);
      return name ? { k: 'rsvp', name, coming: said.coming === true } : null;
    }
    case 'night_done': {
      const dads = num(said.dads);
      const lines = num(said.lines);
      return dads !== null && lines !== null ? { k: 'night_done', dads, lines } : null;
    }
    case 'check_in': {
      const name = str(said.name);
      const rating = num(said.rating);
      return name && rating !== null
        ? { k: 'check_in', name, rating, note: str(said.note) ?? '' }
        : null;
    }
    case 'commitment': {
      const name = str(said.name);
      const body = str(said.body);
      return name && body ? { k: 'commitment', name, body } : null;
    }
    case 'outcome': {
      const name = str(said.name);
      const body = str(said.body);
      return name && body
        ? { k: 'outcome', name, body, note: str(said.note) ?? '', done: said.done === true }
        : null;
    }
    case 'table_seated':
    case 'table_left': {
      const name = str(said.name);
      return name ? { k: said.k, name } : null;
    }
    case 'table_started':
      return { k: 'table_started' };
    case 'table_over': {
      const summary = str(said.summary);
      return summary ? { k: 'table_over', summary } : null;
    }
    default:
      return null;
  }
}

/**
 * The same fact, in whichever language is being read.
 *
 * `joined` means the line above is about the same act by the same dad — a
 * check-in and the commitment written with it — so his name is already on the
 * screen and saying it twice is the room stuttering.
 */
export function describeSaid(t: T, lang: Lang, said: Said, joined = false): string {
  switch (said.k) {
    case 'night_set': {
      // Only the weekday and the clock are read; the zone is the group's and
      // does not belong in a sentence about it.
      const night: DadNight = { weekday: said.weekday, time: said.time, tz: 'UTC' };
      return t('sys.night_set', { by: said.by, when: nightWhen(lang, night) });
    }
    case 'night_cleared':
      return t('sys.night_cleared', { by: said.by });
    case 'night_open':
      return t('sys.night_open');
    case 'night_done':
      return said.dads === 0
        ? t('sys.night_done_none')
        : t('sys.night_done', {
            dads: t(`sys.night_dads_${plural(lang, said.dads)}`, { n: said.dads }),
            lines: t(`sys.night_lines_${plural(lang, said.lines)}`, { n: said.lines }),
          });
    case 'rsvp':
      return t(said.coming ? 'sys.rsvp_in' : 'sys.rsvp_out', { name: said.name });
    case 'check_in':
      return t(said.note ? 'sys.check_in_note' : 'sys.check_in', {
        name: said.name,
        rating: said.rating,
        note: said.note,
      });
    case 'commitment':
      return joined
        ? t('sys.commitment_short', { body: said.body })
        : t('sys.commitment', { name: said.name, body: said.body });
    case 'outcome': {
      const key = said.done
        ? said.note
          ? 'sys.kept_note'
          : 'sys.kept'
        : said.note
          ? 'sys.missed_note'
          : 'sys.missed';
      return t(key, { name: said.name, body: said.body, note: said.note });
    }
    case 'table_seated':
      return t('sys.table_seated', { name: said.name });
    case 'table_left':
      return t('sys.table_left', { name: said.name });
    case 'table_started':
      return t('sys.table_started');
    case 'table_over':
      return t('sys.table_over', { summary: said.summary });
  }
}

const EN = translator('en');

/** The English of it, which is what goes in the archive's `body` column. */
export function englishOf(said: Said): string {
  return describeSaid(EN, 'en', said);
}
