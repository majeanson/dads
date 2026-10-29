import { env, exports as workerExports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { sendable, subscribersExcept, type PushTarget } from '../src/worker/push';
import { cookieFrom, postJoin, resetTables, seedGroup } from './helpers';

const worker = workerExports.default;

/**
 * Quiet hours and a pause for push (2026-10-29), modelled on Google Chat's
 * snooze and scheduled Do Not Disturb. Per dad, across his phones, dropped
 * and never replayed.
 */
describe('quiet hours', () => {
  beforeEach(async () => {
    await resetTables();
  });

  async function dads() {
    const group = await seedGroup();
    const join = async (name: string) => {
      const res = await worker.fetch(
        postJoin({ code: group.code, displayName: name, deviceToken: name.padEnd(43, 'x') }),
      );
      return {
        cookie: cookieFrom(res),
        id: ((await res.json()) as { member: { id: string } }).member.id,
      };
    };
    return { group, marc: await join('Marc'), sam: await join('Sam'), luc: await join('Luc') };
  }

  const call = (method: 'GET' | 'PUT', cookie: string, body?: unknown) =>
    worker.fetch('https://dads.test/api/quiet', {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const WINDOW = { from: '22:00', to: '07:00', tz: 'America/Montreal' };

  it('is for the door’s members only, and empty until he sets something', async () => {
    expect((await worker.fetch('https://dads.test/api/quiet')).status).toBe(401);
    const { marc } = await dads();
    expect(await (await call('GET', marc.cookie)).json()).toEqual({
      from: null,
      to: null,
      tz: null,
      snoozedUntil: null,
    });
  });

  it('keeps a window, changes only what it names, and clears it', async () => {
    const { marc } = await dads();
    expect(await (await call('PUT', marc.cookie, { window: WINDOW })).json()).toMatchObject(WINDOW);

    // A pause leaves the window alone.
    const before = Date.now();
    const paused = (await (await call('PUT', marc.cookie, { snooze: '8h' })).json()) as {
      from: string;
      snoozedUntil: number;
    };
    expect(paused.from).toBe('22:00');
    // Counted from the server's now, eight hours on.
    expect(paused.snoozedUntil).toBeGreaterThanOrEqual(before + 8 * 3600_000);
    expect(paused.snoozedUntil).toBeLessThan(before + 8 * 3600_000 + 60_000);

    // Ending the pause leaves the window; clearing the window leaves nothing.
    expect(await (await call('PUT', marc.cookie, { snooze: null })).json()).toMatchObject({
      from: '22:00',
      snoozedUntil: null,
    });
    expect(await (await call('PUT', marc.cookie, { window: null })).json()).toEqual({
      from: null,
      to: null,
      tz: null,
      snoozedUntil: null,
    });
  });

  it('refuses what it cannot read, and changes nothing', async () => {
    const { marc } = await dads();
    await call('PUT', marc.cookie, { window: WINDOW });
    for (const body of [
      {},
      { window: { ...WINDOW, from: '25:00' } },
      { window: { ...WINDOW, tz: 'Not/AZone' } },
      { window: { ...WINDOW, to: '22:00' } },
      { window: { from: '22:00' } },
      { window: 'always' },
      { snooze: '2h' },
      { snooze: 'toString' },
      { snooze: 8 },
    ]) {
      expect((await call('PUT', marc.cookie, body)).status).toBe(400);
    }
    expect(await (await call('GET', marc.cookie)).json()).toMatchObject(WINDOW);
  });

  it('is his own: one dad’s pause is not another’s', async () => {
    const { marc, sam } = await dads();
    await call('PUT', marc.cookie, { snooze: '24h' });
    expect(
      ((await (await call('GET', sam.cookie)).json()) as { snoozedUntil: null }).snoozedUntil,
    ).toBeNull();
  });

  it('drops a push to a dad who is paused or inside his window, and only him', async () => {
    const { group, marc, sam, luc } = await dads();
    for (const [dad, who] of [
      [marc, 'marc'],
      [sam, 'sam'],
      [luc, 'luc'],
    ] as const) {
      await env.DB.prepare(
        `INSERT INTO push_subscriptions (endpoint, group_id, member_id, p256dh, auth, created_at)
         VALUES (?, ?, ?, 'k', 'a', 0)`,
      )
        .bind(`https://fcm.googleapis.com/fcm/send/${who}`, group.id, dad.id)
        .run();
    }
    // Marc: paused. Sam: a window that covers all day but for one minute, in
    // a zone chosen so that "now" is inside it. Luc: nothing.
    await call('PUT', marc.cookie, { snooze: '1h' });
    const nowClock = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date());
    const [h, m] = nowClock.split(':').map(Number) as [number, number];
    const at = (mins: number) => {
      const t = (((mins % 1440) + 1440) % 1440) as number;
      return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    };
    await call('PUT', sam.cookie, {
      window: { from: at(h * 60 + m - 30), to: at(h * 60 + m + 30), tz: 'UTC' },
    });

    const targets = (await subscribersExcept(env, group.id, []).all<PushTarget>()).results;
    expect(targets).toHaveLength(3);
    expect(sendable(targets, Date.now()).map((t) => t.endpoint)).toEqual([
      'https://fcm.googleapis.com/fcm/send/luc',
    ]);

    // Their pauses end; the push goes out again, with nothing replayed.
    const later = Date.now() + 2 * 3600_000;
    const afterwards = sendable(targets, later).map((t) => t.endpoint);
    expect(afterwards).toContain('https://fcm.googleapis.com/fcm/send/marc');
    expect(afterwards).toContain('https://fcm.googleapis.com/fcm/send/luc');
  });

  it('does not push to a dad who has left', async () => {
    const { group, marc } = await dads();
    await env.DB.prepare(
      `INSERT INTO push_subscriptions (endpoint, group_id, member_id, p256dh, auth, created_at)
       VALUES ('https://fcm.googleapis.com/fcm/send/gone', ?, ?, 'k', 'a', 0)`,
    )
      .bind(group.id, marc.id)
      .run();
    await env.DB.prepare('UPDATE members SET gone_at = 1 WHERE id = ?').bind(marc.id).run();
    expect((await subscribersExcept(env, group.id, []).all()).results).toHaveLength(0);
  });
});
