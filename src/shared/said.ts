import { plural, nightWhen, translator, type Lang, type T } from './dictionary';
import { dayName } from './calendarMonth';
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
  /** `date` only when the night was arranged for one evening rather than set
   * as a standing slot — "Marc locked in Thursday 24 September" reads nothing
   * like "Marc set dad night to Thursdays". */
  | { k: 'night_set'; by: string; weekday: number; time: string; date?: string }
  | { k: 'night_cleared'; by: string }
  /**
   * An evening the group had arranged, called off.
   *
   * Its own kind rather than `night_cleared`, because they are not the same
   * news: clearing a standing night means the group stops having one, and
   * this means the thing four men arranged their Thursday around is not
   * happening. It carries the date so the room can say which evening.
   */
  | { k: 'night_off'; by: string; date: string }
  /**
   * The word that opens the room changed, and who changed it.
   *
   * Never the word itself. The men in the room do not need it — they are
   * already inside — and a line in an archive is the last place a passphrase
   * should live. It is said at all because somebody was about to text the old
   * one to a friend.
   */
  | { k: 'word_changed'; by: string }
  /** The room handed from one man to another. Both names, because it is a
   * fact about both of them. */
  | { k: 'room_handed'; by: string; to: string }
  /** The one-off has been and gone, so the group has no next night. Said by
   * the room itself, right after the summary, because the moment everybody is
   * still there is the moment the next one gets arranged. */
  | { k: 'poll_open' }
  /** `items` is how many things the week put up for it, absent when none. */
  | { k: 'night_open'; items?: number }
  | { k: 'item_added'; name: string; body: string }
  | {
      k: 'night_done';
      dads: number;
      lines: number;
      /** Commitments written for the night's week — what is being tried. */
      tried?: number;
      /** Last week's commitments, and how many were kept. Absent on a line
       * said before the summary carried the week. */
      kept?: number;
      promised?: number;
    }
  /**
   * `coming` is what every line written before "maybe" existed carries, and is
   * still written beside `answer` so a client running last week's build reads
   * a maybe as the "can't" it is closer to. `answer` is the truth.
   */
  | { k: 'rsvp'; name: string; coming: boolean; answer?: 'in' | 'maybe' | 'out' }
  | { k: 'check_in'; name: string; rating: number; note: string }
  | { k: 'commitment'; name: string; body: string }
  | { k: 'outcome'; name: string; body: string; note: string; done: boolean }
  /** A dad changed the name he goes by. In a room of five, a name changing
   * with nothing said is four men wondering who the new bloke is. */
  | { k: 'renamed'; was: string; now: string }
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
      const date = str(said.date);
      if (!by || weekday === null || !time) return null;
      return { k: 'night_set', by, weekday, time, ...(date ? { date } : {}) };
    }
    case 'poll_open':
      return { k: 'poll_open' };
    case 'night_cleared': {
      const by = str(said.by);
      return by ? { k: 'night_cleared', by } : null;
    }
    case 'night_off': {
      const by = str(said.by);
      const date = str(said.date);
      return by && date ? { k: 'night_off', by, date } : null;
    }
    case 'word_changed': {
      const by = str(said.by);
      return by ? { k: 'word_changed', by } : null;
    }
    case 'room_handed': {
      const by = str(said.by);
      const to = str(said.to);
      return by && to ? { k: 'room_handed', by, to } : null;
    }
    case 'night_open': {
      const items = num(said.items);
      return items !== null && items > 0 ? { k: 'night_open', items } : { k: 'night_open' };
    }
    case 'item_added': {
      const name = str(said.name);
      const body = str(said.body);
      return name && body ? { k: 'item_added', name, body } : null;
    }
    case 'rsvp': {
      const name = str(said.name);
      if (!name) return null;
      const answer = said.answer === 'in' || said.answer === 'maybe' || said.answer === 'out';
      return {
        k: 'rsvp',
        name,
        coming: said.coming === true,
        ...(answer ? { answer: said.answer as 'in' | 'maybe' | 'out' } : {}),
      };
    }
    case 'night_done': {
      const dads = num(said.dads);
      const lines = num(said.lines);
      if (dads === null || lines === null) return null;
      const tried = num(said.tried);
      const kept = num(said.kept);
      const promised = num(said.promised);
      return {
        k: 'night_done',
        dads,
        lines,
        ...(tried !== null ? { tried } : {}),
        ...(kept !== null && promised !== null ? { kept, promised } : {}),
      };
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
    case 'renamed': {
      const was = str(said.was);
      const now = str(said.now);
      return was && now ? { k: 'renamed', was, now } : null;
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
      // A date is a night the group ARRANGED, and the sentence says so: "set
      // dad night to Thursdays" is a standing appointment, and this is not.
      if (said.date) {
        return t('sys.night_picked', {
          by: said.by,
          when: dayName(lang, said.date),
          time: said.time,
        });
      }
      return t('sys.night_set', { by: said.by, when: nightWhen(lang, night) });
    }
    case 'night_cleared':
      return t('sys.night_cleared', { by: said.by });
    case 'night_off':
      return t('sys.night_off', { by: said.by, when: dayName(lang, said.date) });
    case 'word_changed':
      return t('sys.word_changed', { by: said.by });
    case 'room_handed':
      return t('sys.room_handed', { by: said.by, to: said.to });
    case 'poll_open':
      return t('sys.poll_open');
    case 'night_open':
      // The count, never the list: the room line is what makes a man open the
      // sheet, and the sheet is where the detail lives. Same rule as the week.
      return said.items === undefined || said.items === 0
        ? t('sys.night_open')
        : t(`sys.night_open_items_${plural(lang, said.items)}`, { n: said.items });
    case 'item_added':
      return t('sys.item_added', { name: said.name, body: said.body });
    case 'night_done': {
      const night =
        said.dads === 0
          ? t('sys.night_done_none')
          : t('sys.night_done', {
              dads: t(`sys.night_dads_${plural(lang, said.dads)}`, { n: said.dads }),
              lines: t(`sys.night_lines_${plural(lang, said.lines)}`, { n: said.lines }),
            });
      // The week, when there is one to report: what is being tried, and how
      // last week's went. It is the one line the whole group reads at once.
      const week = [
        said.tried ? t(`sys.night_tried_${plural(lang, said.tried)}`, { n: said.tried }) : null,
        said.promised ? t('sys.night_kept', { kept: said.kept ?? 0, total: said.promised }) : null,
      ].filter((s): s is string => s !== null);
      if (week.length === 0) return night;
      const sentence = week.join(', ');
      return `${night} ${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
    }
    case 'rsvp': {
      const answer = said.answer ?? (said.coming ? 'in' : 'out');
      return t(`sys.rsvp_${answer}`, { name: said.name });
    }
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
    case 'renamed':
      return t('sys.renamed', { was: said.was, now: said.now });
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
