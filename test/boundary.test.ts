import { runInDurableObject } from 'cloudflare:test';
import { env, exports as workerExports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { icsText } from '../src/worker/routes/calendar';
import { arrived, cookieFrom, postJoin, resetTables, seedGroup, type SeededGroup } from './helpers';

const worker = workerExports.default;

/**
 * What the Worker lets through to the room, and from whom.
 *
 * Each of these came out of reading the source the way a stranger can now
 * that the repository is public.
 */

const SIBLING = 'https://jaffre.marcportal.com';

describe('another site’s page', () => {
  let group: SeededGroup;
  let cookie: string;
  beforeEach(async () => {
    await resetTables();
    group = await seedGroup();
    cookie = cookieFrom(await worker.fetch(postJoin({ code: group.code, displayName: 'Marc' })));
  });

  it('cannot write with a dad’s cookie', async () => {
    // SameSite=Lax sends the cookie from any *.marcportal.com: same site.
    const res = await worker.fetch('https://dads.test/api/rooms/leave', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: SIBLING },
    });
    expect(res.status).toBe(403);
    const me = await worker.fetch('https://dads.test/api/me', { headers: { Cookie: cookie } });
    expect(me.status).toBe(200);
  });

  it('cannot open the room’s socket', async () => {
    const res = await worker.fetch('https://dads.test/ws', {
      headers: { Upgrade: 'websocket', Cookie: cookie, Origin: SIBLING },
    });
    expect(res.status).toBe(403);
  });

  it('can still read, and the app’s own page can still write', async () => {
    expect(
      (
        await worker.fetch('https://dads.test/api/me', {
          headers: { Cookie: cookie, Origin: SIBLING },
        })
      ).status,
    ).toBe(200);
    const own = await worker.fetch('https://dads.test/api/me/name', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://dads.test' },
      body: JSON.stringify({ displayName: 'Marc T' }),
    });
    expect(own.status).not.toBe(403);
  });
});

describe('what the room is told about who is at the door', () => {
  beforeEach(resetTables);

  it('is the session’s, never a header the client sent', async () => {
    const group = await seedGroup();
    const cookie = cookieFrom(
      await worker.fetch(postJoin({ code: group.code, displayName: 'Marc' })),
    );
    // A room with no night, and a socket that claims one.
    const res = await worker.fetch('https://dads.test/ws', {
      headers: {
        Upgrade: 'websocket',
        Cookie: cookie,
        'X-Dads-Night': JSON.stringify({ weekday: 4, time: '21:00', tz: 'America/Montreal' }),
        'X-Dads-Face': '12345',
      },
    });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    const frames: { t: string }[] = [];
    ws.accept();
    ws.addEventListener('message', (e) => {
      if (e.data !== 'pong') frames.push(JSON.parse(e.data as string) as { t: string });
    });
    await arrived({ frames });

    const armed = await runInDurableObject(
      env.ROOM.get(env.ROOM.idFromName(group.id)),
      (_instance, state) =>
        state.storage.sql
          .exec<{ kind: string }>('SELECT kind FROM schedule')
          .toArray()
          .map((r) => r.kind),
    );
    expect(armed).toEqual([]);
    ws.close(1000, 'bye');
  });
});

describe('a room’s name in a calendar', () => {
  it('stays on its own line', () => {
    expect(icsText('Dads\r\nURL:https://evil.example')).toBe('Dads\\nURL:https://evil.example');
    expect(icsText('Mon; Tue, and a \\')).toBe('Mon\\; Tue\\, and a \\\\');
    expect(icsText('The Dads')).toBe('The Dads');
  });
});
