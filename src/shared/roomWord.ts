/**
 * A word for a new room, picked for the man who is opening it.
 *
 * The word is the whole of the lock on a room — the door takes a word and
 * nothing else, and it is unique across every room — so what a man types into
 * an empty box ("dads", "1234") is what stands between five men's private
 * conversation and anyone who tries a few. This hands him a better one to
 * start from: two plain words and three digits, easy to say over the phone and
 * to type once. About 27 bits, behind a throttle of ten tries per address per
 * ten minutes.
 *
 * Pure, with the randomness taken as an argument, so a test can pin it. The
 * lists are short, lower-case, unambiguous when spoken, and carry nothing a
 * man would be embarrassed to text to his friends.
 */

const FIRST = [
  'amber',
  'argent',
  'autumn',
  'bold',
  'brave',
  'bright',
  'brisk',
  'calm',
  'cedar',
  'clever',
  'cobalt',
  'copper',
  'crisp',
  'daring',
  'dusty',
  'eager',
  'ember',
  'fancy',
  'fleet',
  'frosty',
  'gentle',
  'golden',
  'granite',
  'happy',
  'hardy',
  'honest',
  'humble',
  'indigo',
  'jolly',
  'keen',
  'kindly',
  'lively',
  'lucky',
  'maple',
  'mellow',
  'mighty',
  'misty',
  'nimble',
  'noble',
  'north',
  'olive',
  'patient',
  'plucky',
  'proud',
  'quick',
  'quiet',
  'rapid',
  'rustic',
  'sandy',
  'scarlet',
  'silver',
  'snowy',
  'solid',
  'steady',
  'stormy',
  'sunny',
  'swift',
  'tawny',
  'tidy',
  'velvet',
  'warm',
  'wild',
  'windy',
  'witty',
] as const;

const SECOND = [
  'badger',
  'beaver',
  'bison',
  'bobcat',
  'caribou',
  'cedar',
  'comet',
  'coyote',
  'crane',
  'creek',
  'falcon',
  'fiddle',
  'finch',
  'fox',
  'glacier',
  'goose',
  'harbor',
  'heron',
  'island',
  'jaybird',
  'kayak',
  'lantern',
  'lynx',
  'meadow',
  'moose',
  'otter',
  'owl',
  'paddle',
  'panther',
  'pebble',
  'pine',
  'puffin',
  'quokka',
  'raven',
  'ridge',
  'river',
  'robin',
  'sparrow',
  'spruce',
  'squirrel',
  'summit',
  'swan',
  'thistle',
  'timber',
  'toboggan',
  'trail',
  'trout',
  'tundra',
  'valley',
  'violin',
  'walrus',
  'willow',
  'wolf',
  'woodpile',
  'yarrow',
  'zephyr',
  'anchor',
  'barn',
  'bridge',
  'campfire',
  'canoe',
  'dock',
  'ferry',
  'lodge',
] as const;

/**
 * `ember-quokka-731`. `random` returns an integer in [0, max), and is the
 * caller's so that the browser can hand in `crypto.getRandomValues` and a
 * test can hand in a counter.
 */
export function roomWord(random: (max: number) => number): string {
  const pick = <T>(list: readonly T[]): T => list[random(list.length)]!;
  const digits = String(100 + random(900));
  return `${pick(FIRST)}-${pick(SECOND)}-${digits}`;
}

/** Unbiased enough for a pass-phrase seed, from the browser's own source. */
export function cryptoRandom(max: number): number {
  const buffer = new Uint32Array(1);
  // Reject the top sliver so that every value is as likely as every other.
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0]! >= limit);
  return buffer[0]! % max;
}
