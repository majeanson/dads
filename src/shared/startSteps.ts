import { stillToCome, type DadNight } from './dadNight';

export type StartStep = 'invite' | 'days' | 'hi';

/**
 * The three things a new room is for, in the order a stranger does them, and
 * which of them are already done.
 *
 * Home shows this in a room of one, in the place the lone invite row had.
 * Nothing is stored: each step is read off a fact the app already has, so a
 * checklist can never disagree with the room — the others are here, there is
 * a night still to come, this dad has said something.
 */
export function startSteps(facts: {
  /** He is the only man in the room. */
  alone: boolean;
  night: DadNight | null;
  /** He has typed at least one line. */
  said: boolean;
  now: number;
}): { step: StartStep; done: boolean }[] {
  return [
    { step: 'invite', done: !facts.alone },
    { step: 'days', done: stillToCome(facts.night, facts.now) },
    { step: 'hi', done: facts.said },
  ];
}
