import { env } from 'cloudflare:workers';
import { expect } from 'vitest';
import type { DadNight } from '../src/shared/dadNight';
import { hashInviteCode, randomToken } from '../src/worker/crypto';

export interface SeededGroup {
  id: string;
  slug: string;
  name: string;
  code: string;
  night?: DadNight;
}

/** Inserts a group the way scripts/create-group.ts does, returning the plaintext code. */
export async function seedGroup(
  overrides: Partial<Pick<SeededGroup, 'slug' | 'name' | 'code' | 'night'>> = {},
): Promise<SeededGroup> {
  const slug = overrides.slug ?? `g-${randomToken(4).toLowerCase()}`;
  const name = overrides.name ?? 'The Dads';
  // Unique per group by default: storage persists across the tests in a file, and
  // two groups with one code would make every join land in the older one.
  const code = overrides.code ?? `maple otter ${randomToken(6).toLowerCase()}`;
  const salt = randomToken(16);
  const id = `grp_${randomToken(12)}`;
  const night = overrides.night;
  await env.DB.prepare(
    `INSERT INTO groups (id, slug, name, invite_code_hash, invite_code_salt,
                         dad_night_weekday, dad_night_time, dad_night_tz, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      slug,
      name,
      await hashInviteCode(code, salt),
      salt,
      night?.weekday ?? null,
      night?.time ?? null,
      night?.tz ?? 'America/Montreal',
      Date.now(),
    )
    .run();
  return { id, slug, name, code, ...(night ? { night } : {}) };
}

/** Storage is per file, not per test: without this, groups and throttle buckets
 * pile up and each wrong guess costs a PBKDF2 run per accumulated group. */
export async function resetTables(): Promise<void> {
  for (const t of ['join_attempts', 'messages', 'media', 'members', 'groups']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
}

export function postJoin(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Request {
  return new Request('https://dads.test/api/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** Pulls `dads_id=...` out of a Set-Cookie header so it can be sent back. */
export function cookieFrom(res: Response): string {
  const header = res.headers.get('Set-Cookie') ?? '';
  const pair = header.split(';')[0] ?? '';
  if (!pair.startsWith('dads_id=')) throw new Error(`no identity cookie in: ${header}`);
  return pair;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Waits for the thing rather than guessing how long it takes.
 *
 * A fixed wait before an assertion is a race, and under a full suite a loaded
 * machine loses it in a different file every time. Counted in tries rather
 * than against the clock, because the alarm tests fake `Date` and a deadline
 * computed from `Date.now()` there never arrives. The predicate may read D1:
 * fan-out happens before the archive write, so a frame having arrived says
 * nothing about the row.
 */
export async function until(done: () => boolean | Promise<boolean>, tries = 300): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await done()) return;
    await pause(10);
  }
  expect(await done()).toBe(true);
}

/** A socket is usable once the room has said hello; before that, nothing it
 * hears is ordered against anything. */
export function arrived(dad: { frames: { t: string }[] }): Promise<void> {
  return until(() => dad.frames.some((f) => f.t === 'hello'));
}

/** Lets the clock move on by a millisecond, so two rows written back to back
 * cannot share a `created_at` and the order they are pruned in is the order
 * they were made in. Not for a file that fakes `Date`: it would never move. */
export async function tick(): Promise<void> {
  const was = Date.now();
  await until(() => Date.now() > was);
}
