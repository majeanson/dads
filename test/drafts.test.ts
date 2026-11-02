import { describe, expect, it } from 'vitest';
import { readDraft, writeDraft, type DraftStore } from '../src/web/drafts';

/** A Storage with nothing behind it but a map. */
function fake(): DraftStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** Private browsing: every call throws. */
const refusing: DraftStore = {
  getItem: () => {
    throw new Error('storage is off');
  },
  setItem: () => {
    throw new Error('storage is full');
  },
  removeItem: () => {
    throw new Error('storage is off');
  },
};

describe('drafts', () => {
  it('gives back what was kept, per room', () => {
    const s = fake();
    writeDraft(s, 'g1', 'half a line\nand a second');
    writeDraft(s, 'g2', 'another room');
    expect(readDraft(s, 'g1')).toBe('half a line\nand a second');
    expect(readDraft(s, 'g2')).toBe('another room');
    expect(s.map.get('dads.draft.g1')).toBe('half a line\nand a second');
  });

  it('is empty with nothing kept', () => {
    expect(readDraft(fake(), 'g1')).toBe('');
    expect(readDraft(null, 'g1')).toBe('');
  });

  it('forgets the key when the field is empty or only space', () => {
    const s = fake();
    writeDraft(s, 'g1', 'something');
    writeDraft(s, 'g1', '  \n ');
    expect(s.map.has('dads.draft.g1')).toBe(false);
    expect(readDraft(s, 'g1')).toBe('');
  });

  it('says nothing when storage refuses', () => {
    expect(() => writeDraft(refusing, 'g1', 'words')).not.toThrow();
    expect(() => writeDraft(refusing, 'g1', '')).not.toThrow();
    expect(readDraft(refusing, 'g1')).toBe('');
  });
});
