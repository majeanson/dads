import { describe, expect, it } from 'vitest';
import {
  CALL_ARTWORK,
  callDropped,
  callSessionText,
  DOWN_GRACE_MS,
  linkVerdict,
  pickPip,
  YOU,
  type PipTile,
} from '../src/web/callAway';

const tile = (memberId: string, over: Partial<PipTile> = {}): PipTile => ({
  memberId,
  hasVideo: true,
  speaking: false,
  ...over,
});

describe('the picture that floats when he switches away', () => {
  it('is the one he enlarged, over whoever is talking', () => {
    const tiles = [tile('sam', { speaking: true }), tile('luc')];
    expect(pickPip(tiles, 'luc')).toBe('luc');
  });

  it('is whoever is talking when nothing is enlarged', () => {
    const tiles = [tile('sam'), tile('luc', { speaking: true })];
    expect(pickPip(tiles, null)).toBe('luc');
  });

  it('is the first one showing when nobody is talking', () => {
    expect(pickPip([tile('sam'), tile('luc')], null)).toBe('sam');
  });

  it('is never his own preview, even enlarged', () => {
    expect(pickPip([tile(YOU, { speaking: true }), tile('sam')], YOU)).toBe('sam');
    expect(pickPip([tile(YOU)], YOU)).toBeNull();
  });

  it('is nothing at all when nobody is showing a picture', () => {
    const tiles = [
      tile('sam', { hasVideo: false, speaking: true }),
      tile('luc', { hasVideo: false }),
    ];
    expect(pickPip(tiles, 'sam')).toBeNull();
    expect(pickPip([], null)).toBeNull();
  });

  it('passes over an enlarged tile whose camera went off', () => {
    const tiles = [tile('sam', { hasVideo: false }), tile('luc')];
    expect(pickPip(tiles, 'sam')).toBe('luc');
  });
});

describe('what the phone is told about the call', () => {
  it('is the room, on the call, in English', () => {
    expect(callSessionText('en', 'The Kitchen')).toEqual({
      title: 'The Kitchen',
      artist: 'On the call',
    });
  });

  it('is the room, dans l’appel, in French', () => {
    expect(callSessionText('fr', 'La Cuisine')).toEqual({
      title: 'La Cuisine',
      artist: 'Dans l’appel',
    });
  });

  it('uses the app’s own icon', () => {
    expect(CALL_ARTWORK[0]?.src).toBe('/icon-192.png');
  });
});

describe('a link, when he comes back', () => {
  const now = 1_000_000;

  it('is restarted at once when it failed', () => {
    expect(linkVerdict('failed', null, now)).toBe('restart');
  });

  it('is left to heal while it has been disconnected less than the grace', () => {
    expect(linkVerdict('disconnected', now - DOWN_GRACE_MS + 1, now)).toBe('keep');
  });

  it('is restarted once it has been disconnected past the grace', () => {
    expect(linkVerdict('disconnected', now - DOWN_GRACE_MS, now)).toBe('restart');
    expect(linkVerdict('disconnected', now - 60_000, now)).toBe('restart');
  });

  it('is left alone while disconnected with no record of when', () => {
    expect(linkVerdict('disconnected', null, now)).toBe('keep');
  });

  it('is a goodbye when it is closed', () => {
    expect(linkVerdict('closed', now - 60_000, now)).toBe('gone');
  });

  it('is kept when it is up or still coming up', () => {
    for (const state of ['new', 'connecting', 'connected'] as const) {
      expect(linkVerdict(state, null, now)).toBe('keep');
    }
  });
});

describe('a call that dropped while he was away', () => {
  it('is dropped when the room no longer counts him', () => {
    expect(callDropped({ onRoster: false, others: 0, connected: 0 })).toBe(true);
  });

  it('is dropped when there are others and nobody is connected', () => {
    expect(callDropped({ onRoster: true, others: 2, connected: 0 })).toBe(true);
  });

  it('is a call while one link is up', () => {
    expect(callDropped({ onRoster: true, others: 2, connected: 1 })).toBe(false);
  });

  it('is not dropped for being alone on it', () => {
    expect(callDropped({ onRoster: true, others: 0, connected: 0 })).toBe(false);
  });
});
