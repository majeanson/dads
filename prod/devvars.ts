import { readFileSync } from 'node:fs';

/**
 * A value production knows and the repo must not, from the environment or
 * from `.dev.vars`.
 *
 * `.dev.vars` is gitignored and is already where this machine keeps such
 * things for `wrangler dev`; the prove suite reads two of its own from there
 * as well — the ops secret the teardown sweeps with, and the word of the
 * room it writes into — so a run needs nothing typed. The environment wins
 * when both are set, which is how a one-off run against another room or
 * another secret is done.
 */
export function devVar(name: string, env = name): string | null {
  const fromEnv = process.env[env];
  if (fromEnv) return fromEnv;
  try {
    const line = readFileSync('.dev.vars', 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${name}=`));
    const value = line ? line.slice(name.length + 1).trim() : '';
    return value === '' ? null : value;
  } catch {
    return null;
  }
}
