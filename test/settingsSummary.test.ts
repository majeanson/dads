import { describe, expect, it } from 'vitest';
import { deviceSummary, roomSummary } from '../src/shared/settingsSummary';

/** The line under each of Settings' rows (2026-11-02). */
describe('roomSummary', () => {
  it('names what the room has on, in order', () => {
    expect(roomSummary('en', { questions: true, week: true, table: true })).toBe(
      'Questions · The week · The table',
    );
    expect(roomSummary('en', { questions: true, week: false, table: false })).toBe('Questions');
    expect(roomSummary('fr', { questions: false, week: true, table: true })).toBe(
      'La semaine · La table',
    );
  });

  it('says so when nothing is on', () => {
    expect(roomSummary('en', { questions: false, week: false, table: false })).toBe(
      'Nothing switched on',
    );
    expect(roomSummary('fr', { questions: false, week: false, table: false })).toBe(
      'Rien d’activé',
    );
  });
});

describe('deviceSummary', () => {
  it('is only the language when nothing else was chosen', () => {
    expect(deviceSummary('en', 'system', 'normal', false)).toBe('EN');
    expect(deviceSummary('fr', 'system', 'normal', false)).toBe('FR');
  });

  it('adds what was chosen, in a fixed order', () => {
    expect(deviceSummary('en', 'dark', 'large', true)).toBe(
      'EN · Dark · Large text · Reminders on',
    );
    expect(deviceSummary('en', 'light', 'larger', false)).toBe('EN · Light · Larger text');
    expect(deviceSummary('fr', 'dark', 'normal', true)).toBe('FR · Sombre · Rappels activés');
  });
});
