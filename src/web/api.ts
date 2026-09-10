import type { DadNight } from '../shared/dadNight';

/** A night as the client sends it: the zone is omitted when the group already
 * has one, so the server keeps it rather than adopting the editor's. */
export type NightInput = Omit<DadNight, 'tz'> & { tz: string | null };

export interface Session {
  group: { id: string; slug: string; name: string; dadNight: DadNight | null };
  member: { id: string; displayName: string };
}

export type JoinError =
  'bad_code' | 'missing_code' | 'missing_name' | 'name_too_long' | 'too_many_attempts' | 'unknown';

export interface JoinFailure {
  error: JoinError;
  retryAfterSeconds?: number;
}

const DEVICE_TOKEN_KEY = 'dads.deviceToken';

/**
 * The device token is the belt to the cookie's braces: if the cookie is lost,
 * this is what tells the server the returning browser is the same dad rather
 * than a second member with the same name. Storage can throw in a locked-down
 * browser, and a dad who cannot read it simply gets a new identity — annoying,
 * never broken.
 */
function readDeviceToken(): string | undefined {
  try {
    return localStorage.getItem(DEVICE_TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeDeviceToken(token: string): void {
  try {
    localStorage.setItem(DEVICE_TOKEN_KEY, token);
  } catch {
    // ignored on purpose: see readDeviceToken
  }
}

export async function fetchSession(): Promise<Session | null> {
  const res = await fetch('/api/me');
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`GET /api/me ${res.status}`);
  return (await res.json()) as Session;
}

export async function join(
  code: string,
  displayName: string,
): Promise<{ ok: true; session: Session } | { ok: false; failure: JoinFailure }> {
  const res = await fetch('/api/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, displayName, deviceToken: readDeviceToken() }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Partial<JoinFailure>;
    return {
      ok: false,
      failure: { error: body.error ?? 'unknown', retryAfterSeconds: body.retryAfterSeconds },
    };
  }

  const body = (await res.json()) as Session & { deviceToken: string };
  writeDeviceToken(body.deviceToken);
  return { ok: true, session: { group: body.group, member: body.member } };
}

export async function leave(): Promise<void> {
  await fetch('/api/leave', { method: 'POST' });
}

/**
 * Any dad can set the group's night; the room announces who did it. Throws on
 * failure so the caller can say so rather than silently doing nothing.
 */
export async function setNight(night: NightInput | null): Promise<void> {
  const res = await fetch('/api/night', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ night }),
  });
  if (!res.ok) throw new Error(`PUT /api/night ${res.status}`);
}

export interface Prompt {
  /** The French of it, or null for one a dad wrote himself. */
  bodyFr?: string | null;
  id: string;
  body: string;
  groupId: string | null;
  authorName: string | null;
}

export interface PoolEntry extends Prompt {
  timesAsked: number;
  lastAsked: string | null;
  answers: number;
}

export interface HistoryEntry {
  bodyFr?: string | null;
  day: string;
  promptId: string;
  body: string;
  answers: number;
}

export interface TodaysPrompt {
  day: string;
  prompt: Prompt;
  answered: boolean;
}

export interface PromptAnswer {
  id: string;
  body: string;
  createdAt: number;
  name: string;
}

export async function fetchTodaysPrompt(): Promise<TodaysPrompt | null> {
  const res = await fetch('/api/prompt');
  if (!res.ok) throw new Error(`GET /api/prompt ${res.status}`);
  const body = (await res.json()) as Partial<TodaysPrompt>;
  return body.prompt ? (body as TodaysPrompt) : null;
}

export async function fetchPrompts(): Promise<{
  today: { day: string; prompt: Prompt } | null;
  pool: PoolEntry[];
  history: HistoryEntry[];
}> {
  const res = await fetch('/api/prompts');
  if (!res.ok) throw new Error(`GET /api/prompts ${res.status}`);
  return (await res.json()) as {
    today: { day: string; prompt: Prompt } | null;
    pool: PoolEntry[];
    history: HistoryEntry[];
  };
}

export async function fetchPromptAnswers(promptId: string): Promise<PromptAnswer[]> {
  const res = await fetch(`/api/prompt-answers?promptId=${encodeURIComponent(promptId)}`);
  if (!res.ok) throw new Error(`GET /api/prompt-answers ${res.status}`);
  return ((await res.json()) as { answers: PromptAnswer[] }).answers;
}

export type AddPromptResult =
  | { ok: true; prompt: PoolEntry }
  | { ok: false; error: 'empty' | 'too_long' | 'already_asked' | 'unknown' };

export async function addPrompt(body: string): Promise<AddPromptResult> {
  const res = await fetch('/api/prompts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  if (res.ok) return { ok: true, prompt: ((await res.json()) as { prompt: PoolEntry }).prompt };
  const failure = (await res.json().catch(() => ({}))) as {
    error?: 'empty' | 'too_long' | 'already_asked';
  };
  return { ok: false, error: failure.error ?? 'unknown' };
}

export type Outcome = 'pending' | 'done' | 'missed';

export interface BoardRow {
  memberId: string;
  name: string;
  checkIn: { rating: number; note: string } | null;
  commitment: { body: string; outcome: Outcome; reflection: string } | null;
}

export interface BoardData {
  week: string;
  weeks: { week: string; rows: BoardRow[] }[];
  pending: { week: string; body: string } | null;
  you: string;
}

export async function fetchBoard(): Promise<BoardData> {
  const res = await fetch('/api/board');
  if (!res.ok) throw new Error(`GET /api/board ${res.status}`);
  return (await res.json()) as BoardData;
}

export async function saveCheckIn(rating: number, note: string): Promise<void> {
  const res = await fetch('/api/check-in', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating, note }),
  });
  if (!res.ok) throw new Error(`PUT /api/check-in ${res.status}`);
}

export async function saveCommitment(body: string): Promise<void> {
  const res = await fetch('/api/commitment', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`PUT /api/commitment ${res.status}`);
}

export async function saveCommitmentOutcome(
  week: string,
  outcome: 'done' | 'missed',
  reflection: string,
): Promise<void> {
  const res = await fetch('/api/commitment-outcome', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ week, outcome, reflection }),
  });
  if (!res.ok) throw new Error(`PUT /api/commitment-outcome ${res.status}`);
}

export interface TableInfo {
  code: string;
  embedUrl: string;
  shareUrl: string;
}

export async function fetchTable(): Promise<TableInfo> {
  const res = await fetch('/api/table');
  if (!res.ok) throw new Error(`GET /api/table ${res.status}`);
  return (await res.json()) as TableInfo;
}

export interface Todo {
  /** Today's question is unanswered by you. */
  prompt: boolean;
  /** Your week is blank, or last week's commitment is still open. */
  board: boolean;
}

export async function fetchTodo(): Promise<Todo> {
  const res = await fetch('/api/todo');
  if (!res.ok) throw new Error(`GET /api/todo ${res.status}`);
  return (await res.json()) as Todo;
}

export interface PresenceEvent {
  name: string;
  kind: 'in' | 'out';
  at: number;
}

export async function fetchPresence(): Promise<PresenceEvent[]> {
  const res = await fetch('/api/presence');
  if (!res.ok) throw new Error(`GET /api/presence ${res.status}`);
  return ((await res.json()) as { events: PresenceEvent[] }).events;
}
