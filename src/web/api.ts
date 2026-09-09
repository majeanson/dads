export interface Session {
  group: { id: string; slug: string; name: string };
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
