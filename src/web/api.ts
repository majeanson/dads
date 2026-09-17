import type { DadNight } from '../shared/dadNight';
import type { Found, RoomsOpen } from '../shared/protocol';

/** A night as the client sends it: the zone is omitted when the group already
 * has one, so the server keeps it rather than adopting the editor's. */
export type NightInput = Omit<DadNight, 'tz'> & { tz: string | null };

export interface Session {
  group: {
    id: string;
    slug: string;
    name: string;
    dadNight: DadNight | null;
    rooms: RoomsOpen;
    /** The member who opened the room, and the only one whose switches these
     * are. Null for a room made before rooms had creators: then they are
     * everybody's, as they were. */
    createdBy: string | null;
  };
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
  invite?: string,
): Promise<{ ok: true; session: Session } | { ok: false; failure: JoinFailure }> {
  const res = await fetch('/api/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, invite, displayName, deviceToken: readDeviceToken() }),
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

/** What can go wrong opening a room. */
export type CreateError =
  | 'missing_room_name'
  | 'room_name_too_long'
  | 'code_too_short'
  | 'code_too_long'
  | 'code_taken'
  | 'missing_name'
  | 'name_too_long'
  | 'too_many_rooms'
  | 'unknown';

/**
 * Open a room of your own, and walk straight into it.
 *
 * One call, not two: the room and its first member are made together and the
 * cookie comes back with them, so a man who has just named his room is not
 * then asked to type its word to get in.
 */
export async function createRoom(
  name: string,
  code: string,
  displayName: string,
): Promise<
  { ok: true; session: Session } | { ok: false; error: CreateError; retryAfterSeconds?: number }
> {
  const res = await fetch('/api/rooms/new', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, code, displayName, deviceToken: readDeviceToken() }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: CreateError;
      retryAfterSeconds?: number;
    };
    return { ok: false, error: body.error ?? 'unknown', retryAfterSeconds: body.retryAfterSeconds };
  }
  const body = (await res.json()) as Session & { deviceToken: string };
  writeDeviceToken(body.deviceToken);
  return { ok: true, session: { group: body.group, member: body.member } };
}

/**
 * A link to hand a dad, minted fresh each time the sheet is opened. The token
 * comes back once and is never stored here: the link IS the secret, and the
 * place for it is his messages app, not our localStorage.
 */
export async function createInvite(): Promise<{ url: string; expiresAt: number }> {
  const res = await fetch('/api/invite', { method: 'POST' });
  if (!res.ok) throw new Error(`POST /api/invite ${res.status}`);
  const body = (await res.json()) as { token: string; expiresAt: number };
  return { url: `${location.origin}/i/${body.token}`, expiresAt: body.expiresAt };
}

/** What can go wrong changing a room's word. */
export type WordError = 'code_too_short' | 'code_too_long' | 'code_taken' | 'not_yours' | 'unknown';

/**
 * Change the word that opens this room. The creator's, like the switches.
 *
 * There is no "current word" to show anywhere in this app: it is kept as a
 * PBKDF2 hash and nothing knows the plaintext. This only ever sets a new one,
 * and the invite links that were out die with it.
 */
export async function setRoomWord(
  code: string,
): Promise<{ ok: true } | { ok: false; error: WordError }> {
  const res = await fetch('/api/rooms/word', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => ({}))) as { error?: WordError };
  return { ok: false, error: body.error ?? 'unknown' };
}

/** Hand the room to another dad. One way: getting it back is him handing it
 * over. */
export async function handRoom(memberId: string): Promise<void> {
  const res = await fetch('/api/rooms/owner', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memberId }),
  });
  if (!res.ok) throw new Error(`PUT /api/rooms/owner ${res.status}`);
}

/** A room this device is in. */
export interface MyRoom {
  id: string;
  name: string;
  slug: string;
  /** What he is called in that one. */
  displayName: string;
  current: boolean;
}

/**
 * Every room this browser belongs to, newest first.
 *
 * The device token is the credential, exactly as it is at the door: it is
 * what says a browser is a man who already joined. The cookie is no use for
 * this — it names one room, and the question is which others there are.
 */
export async function fetchMyRooms(): Promise<MyRoom[]> {
  const res = await fetch('/api/rooms/mine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceToken: readDeviceToken() }),
  });
  if (!res.ok) return [];
  return ((await res.json()) as { rooms: MyRoom[] }).rooms;
}

/** Move this browser to another of his rooms. The caller reloads: the socket,
 * the session and everything read from them are keyed to the group. */
export async function switchRoom(groupId: string): Promise<boolean> {
  const res = await fetch('/api/rooms/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupId, deviceToken: readDeviceToken() }),
  });
  return res.ok;
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

/** What a dad can answer, on the night and on the calendar that picks it. */
export type Answer = 'in' | 'maybe' | 'out';

export interface Rsvp {
  memberId: string;
  name: string;
  answer: Answer;
}

export interface NightItem {
  id: string;
  memberId: string;
  name: string;
  body: string;
}

export interface NightState {
  /** The instant the evening being answered starts, or null if there is no
   * night set. Decided by the server, never by this clock. */
  occurrence: number | null;
  answers: Rsvp[];
  items: NightItem[];
}

export async function fetchNight(): Promise<NightState> {
  const res = await fetch('/api/night');
  if (!res.ok) throw new Error(`GET /api/night ${res.status}`);
  return (await res.json()) as NightState;
}

export async function setRsvp(answer: Answer): Promise<NightState> {
  const res = await fetch('/api/rsvp', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer }),
  });
  if (!res.ok) throw new Error(`PUT /api/rsvp ${res.status}`);
  return (await res.json()) as NightState;
}

export interface DayVote {
  memberId: string;
  name: string;
  answer: Answer;
}

export interface PollState {
  /** Whether the group is being asked when the next one is — which is exactly
   * when it has no night still to come. Decided by the server. */
  open: boolean;
  /** Today as the GROUP's calendar reads it. A phone in another country must
   * not be able to vote on a day that is already over back home. */
  today: string;
  /** The hour the lock-in offers, which is the one they last used. */
  time: string;
  days: { day: string; votes: DayVote[] }[];
}

export async function fetchPoll(): Promise<PollState> {
  const res = await fetch('/api/poll');
  if (!res.ok) throw new Error(`GET /api/poll ${res.status}`);
  return (await res.json()) as PollState;
}

/** A mark on one day, or `null` to take it off — which is a different thing
 * from "can't": one is a man who has not looked at that day. */
export async function setVote(day: string, answer: Answer | null): Promise<PollState> {
  const res = await fetch('/api/poll', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ day, answer }),
  });
  if (!res.ok) throw new Error(`PUT /api/poll ${res.status}`);
  return (await res.json()) as PollState;
}

/** That's the night. Any dad may, and the room says who did. */
export async function pickDay(day: string, time: string): Promise<PollState> {
  const res = await fetch('/api/poll/pick', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ day, time }),
  });
  if (!res.ok) throw new Error(`POST /api/poll/pick ${res.status}`);
  return ((await res.json()) as { poll: PollState }).poll;
}

/** Something to get into on the night. Anyone may add; the room hears it. */
export async function addNightItem(body: string): Promise<NightState> {
  const res = await fetch('/api/night-item', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`POST /api/night-item ${res.status}`);
  return (await res.json()) as NightState;
}

/** Taking your own back. The server only lets a man remove what he wrote. */
export async function removeNightItem(id: string): Promise<NightState> {
  const res = await fetch(`/api/night-item?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE /api/night-item ${res.status}`);
  return (await res.json()) as NightState;
}

/** What the group has open. Any dad may change it; everyone sees it. */
export async function setRooms(rooms: Partial<RoomsOpen>): Promise<void> {
  const res = await fetch('/api/rooms', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rooms),
  });
  if (!res.ok) throw new Error(`PUT /api/rooms ${res.status}`);
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

export type { Found } from '../shared/protocol';

/**
 * A line, found again.
 *
 * Against D1 rather than against what is loaded: the conversation on the
 * screen is the last five hundred lines, and the whole point of looking
 * something up is that it is older than that.
 */
export async function findLines(q: string, signal?: AbortSignal): Promise<Found[]> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) throw new Error(`GET /api/search ${res.status}`);
  return ((await res.json()) as { results: Found[] }).results;
}

/**
 * A dad's own name, changed after the door.
 *
 * It was settable exactly once, and changing it meant signing out and
 * rejoining — which in this app means arriving as a stranger with none of
 * your history. The room announces it by name, because a name changing with
 * nothing said is four men wondering who the new bloke is.
 */
export async function setMyName(name: string): Promise<void> {
  const res = await fetch('/api/me/name', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`PUT /api/me/name ${res.status}`);
}

/** His face. Square, shrunk in the browser, replacing whatever was there. */
export async function setMyFace(blob: Blob): Promise<void> {
  const res = await fetch('/api/me/face', {
    method: 'PUT',
    headers: { 'Content-Type': blob.type || 'image/jpeg' },
    body: blob,
  });
  if (!res.ok) throw new Error(`PUT /api/me/face ${res.status}`);
}

export async function clearMyFace(): Promise<void> {
  const res = await fetch('/api/me/face', { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE /api/me/face ${res.status}`);
}

/**
 * Where a dad's face lives, or null for a dad who has not set one.
 *
 * The version is in the URL rather than in a header, which is what lets the
 * picture be cached for a year: a new face is a new `v` and therefore a new
 * URL, so nothing is ever revalidated and nothing is ever stale.
 */
export function faceUrl(memberId: string, version: number | undefined): string | null {
  return version === undefined ? null : `/api/face?member=${memberId}&v=${version}`;
}

/**
 * Take a picture off the shelf, or put it back on it.
 *
 * Any dad, on anybody's picture — the room's rule, not this client's. The
 * answer everyone else sees comes back over the socket as a `kept` frame, so
 * nothing here has to tell the conversation about it.
 */
export async function keepMedia(id: string, on: boolean): Promise<'ok' | 'full' | 'failed'> {
  try {
    const res = await fetch('/api/media/keep', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, on }),
    });
    if (res.ok) return 'ok';
    return res.status === 409 ? 'full' : 'failed';
  } catch {
    // The wifi-to-LTE hop this whole app is built around. A keep that never
    // left is a keep that did not happen, and the man has to be told.
    return 'failed';
  }
}
