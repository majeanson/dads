import { describe, expect, it } from 'vitest';
import { EN_KEYS, FR_KEYS, TABLES } from '../src/shared/dictionary';

/**
 * The two dictionaries have to stay level with each other.
 *
 * A missing French key is not a type error — the record is typed by the
 * English one, so TypeScript catches an absent key but not an English string
 * that was never actually translated, and not a placeholder that was dropped
 * on the way across. Both of those ship as a half-English screen.
 */
describe('the dictionary', () => {
  it('says the same things in both languages', () => {
    expect(FR_KEYS).toEqual(EN_KEYS);
  });

  it('keeps every placeholder on both sides', () => {
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of EN_KEYS) {
      expect({ key, holes: holes(TABLES.fr[key]) }).toEqual({ key, holes: holes(TABLES.en[key]) });
    }
  });

  it('has no French string left in English', () => {
    // Not a translation checker — it only catches the strings that were copied
    // across and never looked at again. A handful of words really are the same
    // in both languages, and those are named here rather than waved through by
    // a rule that would also wave through a whole untranslated screen.
    const SAME_IN_BOTH = ['Code', 'Menu', 'Messages', '…'];
    const suspicious = EN_KEYS.filter(
      (key) => TABLES.en[key] === TABLES.fr[key] && !SAME_IN_BOTH.includes(TABLES.en[key]),
    );
    expect(suspicious).toEqual([]);
  });
});
