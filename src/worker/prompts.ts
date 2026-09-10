import { civilDayIn } from '../shared/dadNight';
import { pickIndex } from '../shared/promptPick';
import type { Env } from './env';

/**
 * Resolving and listing the day's question. Used by the API routes and by the
 * Durable Object, which both need to agree on what today's prompt is.
 */

export const MAX_PROMPT_LENGTH = 240;
export const MAX_ANSWER_LENGTH = 2000;
/** How far back the list view shows. Long enough to see a habit, short enough
 * to stay one screen of scrolling. */
const HISTORY_DAYS = 60;

export interface Prompt {
  id: string;
  body: string;
  /**
   * The same question in French, for a dad reading in French. Null for one a
   * dad wrote himself: he asked it in his own words, and translating a man's
   * question for him is not this app's business.
   */
  bodyFr: string | null;
  /** null for the curated library, the group's id for one a dad wrote. */
  groupId: string | null;
  authorName: string | null;
}

export interface TodaysPrompt {
  day: string;
  prompt: Prompt;
}

async function groupTimeZone(env: Env, groupId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT dad_night_tz FROM groups WHERE id = ?')
    .bind(groupId)
    .first<{ dad_night_tz: string }>();
  return row?.dad_night_tz ?? 'America/Montreal';
}

/**
 * Scoped to the group even though every current caller already resolved the id
 * from that group's own rows: this is the one place a prompt is read by id,
 * and it should not be possible to reach another group's through it.
 */
async function promptById(env: Env, groupId: string, id: string): Promise<Prompt | null> {
  const row = await env.DB.prepare(
    `SELECT p.id, p.body, p.body_fr, p.group_id, m.display_name AS author_name
       FROM prompts p LEFT JOIN members m ON m.id = p.author_member_id
      WHERE p.id = ? AND (p.group_id IS NULL OR p.group_id = ?)`,
  )
    .bind(id, groupId)
    .first<{
      id: string;
      body: string;
      body_fr: string | null;
      group_id: string | null;
      author_name: string | null;
    }>();
  if (!row) return null;
  return {
    id: row.id,
    body: row.body,
    bodyFr: row.body_fr,
    groupId: row.group_id,
    authorName: row.author_name,
  };
}

/**
 * The group's question for the day `now` falls on, in the group's own zone.
 *
 * Written to prompt_days the first time it is asked for and never recomputed:
 * the pick is deterministic, but the pool it picks from is not fixed, so a dad
 * adding a prompt this afternoon must not change this morning's question.
 */
export async function todaysPrompt(
  env: Env,
  groupId: string,
  now = Date.now(),
): Promise<TodaysPrompt | null> {
  const day = civilDayIn(now, await groupTimeZone(env, groupId));

  const pinned = await env.DB.prepare(
    'SELECT prompt_id FROM prompt_days WHERE group_id = ? AND day = ?',
  )
    .bind(groupId, day)
    .first<{ prompt_id: string }>();
  if (pinned) {
    const prompt = await promptById(env, groupId, pinned.prompt_id);
    if (prompt) return { day, prompt };
    // The pinned prompt was deleted outright. Fall through and pick again
    // rather than showing a group nothing.
  }

  const { results } = await env.DB.prepare(
    `SELECT id FROM prompts
      WHERE active = 1 AND (group_id IS NULL OR group_id = ?)
      ORDER BY id`,
  )
    .bind(groupId)
    .all<{ id: string }>();
  const index = pickIndex(groupId, day, results.length);
  if (index === null) return null;

  const chosen = results[index]!.id;
  // INSERT OR REPLACE, not OR IGNORE: if the fall-through above fired, the
  // stale row must actually be replaced.
  await env.DB.prepare(
    'INSERT OR REPLACE INTO prompt_days (group_id, day, prompt_id) VALUES (?, ?, ?)',
  )
    .bind(groupId, day, chosen)
    .run();

  const prompt = await promptById(env, groupId, chosen);
  return prompt ? { day, prompt } : null;
}

export interface PoolEntry extends Prompt {
  /** How many times this group has been asked it. */
  timesAsked: number;
  /** The most recent day this group was asked it, if ever. */
  lastAsked: string | null;
  /** How many answers this group has given it, all time. */
  answers: number;
}

/** Everything the group can be asked, with what it has done with each. */
export async function promptPool(env: Env, groupId: string): Promise<PoolEntry[]> {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.body, p.body_fr, p.group_id, m.display_name AS author_name,
            (SELECT COUNT(*) FROM prompt_days d
              WHERE d.prompt_id = p.id AND d.group_id = ?1) AS times_asked,
            (SELECT MAX(d.day) FROM prompt_days d
              WHERE d.prompt_id = p.id AND d.group_id = ?1) AS last_asked,
            (SELECT COUNT(*) FROM messages msg
              WHERE msg.prompt_id = p.id AND msg.group_id = ?1) AS answers
       FROM prompts p
       LEFT JOIN members m ON m.id = p.author_member_id
      WHERE p.active = 1 AND (p.group_id IS NULL OR p.group_id = ?1)
      ORDER BY p.group_id IS NULL, p.created_at DESC, p.id`,
  )
    .bind(groupId)
    .all<{
      id: string;
      body: string;
      body_fr: string | null;
      group_id: string | null;
      author_name: string | null;
      times_asked: number;
      last_asked: string | null;
      answers: number;
    }>();

  return results.map((r) => ({
    id: r.id,
    body: r.body,
    bodyFr: r.body_fr,
    groupId: r.group_id,
    authorName: r.author_name,
    timesAsked: r.times_asked,
    lastAsked: r.last_asked,
    answers: r.answers,
  }));
}

export interface HistoryEntry {
  day: string;
  promptId: string;
  body: string;
  bodyFr: string | null;
  answers: number;
}

/** What the group was asked recently, newest first. */
export async function promptHistory(env: Env, groupId: string): Promise<HistoryEntry[]> {
  const { results } = await env.DB.prepare(
    `SELECT d.day, d.prompt_id, p.body, p.body_fr,
            (SELECT COUNT(*) FROM messages msg
              WHERE msg.prompt_id = d.prompt_id AND msg.group_id = ?1) AS answers
       FROM prompt_days d JOIN prompts p ON p.id = d.prompt_id
      WHERE d.group_id = ?1
      ORDER BY d.day DESC
      LIMIT ?2`,
  )
    .bind(groupId, HISTORY_DAYS)
    .all<{
      day: string;
      prompt_id: string;
      body: string;
      body_fr: string | null;
      answers: number;
    }>();

  return results.map((r) => ({
    day: r.day,
    promptId: r.prompt_id,
    body: r.body,
    bodyFr: r.body_fr,
    answers: r.answers,
  }));
}

/** The answers this group has given a prompt, oldest first. */
export async function answersFor(env: Env, groupId: string, promptId: string) {
  const { results } = await env.DB.prepare(
    `SELECT msg.id, msg.body, msg.created_at, m.display_name AS name
       FROM messages msg LEFT JOIN members m ON m.id = msg.member_id
      WHERE msg.group_id = ? AND msg.prompt_id = ?
      ORDER BY msg.created_at`,
  )
    .bind(groupId, promptId)
    .all<{ id: string; body: string; created_at: number; name: string | null }>();
  return results.map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: r.created_at,
    name: r.name ?? 'a dad',
  }));
}
