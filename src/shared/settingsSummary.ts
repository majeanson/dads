import { translator, type Lang } from './dictionary';
import type { RoomsOpen } from './protocol';

/**
 * The one line under each row of Settings' first screen, saying what is
 * behind it without opening it (Marc, 2026-11-02: "arrange settings
 * differently so it's less cluttered" — the sheet became four rows, each a
 * door, and a door that says nothing about the room behind it gets opened
 * just to look).
 *
 * Pure, so it is tested without a browser. Short words joined with a middle
 * dot: these sit on one truncated line under a label on a 390px phone.
 */
const DOT = ' · ';

/** Which of the room's three are on, or that none is. */
export function roomSummary(lang: Lang, rooms: RoomsOpen): string {
  const t = translator(lang);
  const on = [
    rooms.questions ? t('menu.questions') : null,
    rooms.week ? t('menu.week') : null,
    rooms.table ? t('set.table') : null,
  ].filter((w): w is string => w !== null);
  return on.length === 0 ? t('set.sum_none') : on.join(DOT);
}

/**
 * What this device reads the room in. Only what was CHOSEN is said beyond
 * the language: "Follow the phone" and "Normal" are what nobody picked, and
 * a summary that spells out every default is the clutter it replaced.
 */
export function deviceSummary(
  lang: Lang,
  theme: 'system' | 'light' | 'dark',
  size: 'normal' | 'large' | 'larger',
  reminders: boolean,
): string {
  const t = translator(lang);
  const parts = [lang.toUpperCase()];
  if (theme !== 'system') parts.push(t(theme === 'light' ? 'theme.light' : 'theme.dark'));
  if (size !== 'normal') parts.push(t(size === 'large' ? 'set.sum_large' : 'set.sum_larger'));
  if (reminders) parts.push(t('set.sum_remind'));
  return parts.join(DOT);
}
