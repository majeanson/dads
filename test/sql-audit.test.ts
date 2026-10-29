import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

/**
 * Reads the Worker's own source and holds its SQL to three house rules:
 *
 *   - every `IN (…)` over a list of unknown length goes through `chunks()`;
 *   - every statement over a group's table names `group_id`;
 *   - every statement over `members` says which of the two it is:
 *     `gone_at IS NULL` (the men in the room) or a deliberate reason not to.
 *
 * It is a grep, not a parser, and it errs toward flagging. An entry in an
 * allowlist below is a decision, with the reason beside it; a new unlisted
 * statement is a failure until somebody makes one.
 */
const files = (
  import.meta as unknown as { glob: (p: string[], o: object) => Record<string, string> }
).glob(['../src/worker/**/*.ts'], { query: '?raw', import: 'default', eager: true });

interface Statement {
  file: string;
  line: number;
  sql: string;
}

const SQL = /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH|REPLACE)\b/i;

function statements(): Statement[] {
  const out: Statement[] = [];
  for (const [path, source] of Object.entries(files)) {
    const file = path.replace('../src/worker/', '');
    for (const m of source.matchAll(/`([^`]*)`|'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) {
      const sql = m[1] ?? m[2] ?? m[3] ?? '';
      if (!SQL.test(sql) || !/\b(FROM|INTO|UPDATE)\b/i.test(sql)) continue;
      out.push({ file, line: source.slice(0, m.index).split('\n').length, sql });
    }
  }
  return out;
}

const tablesIn = (sql: string): string[] =>
  [...sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_]+)/gi)].map((m) => m[1]!.toLowerCase());

/** `file:fragment` → why. The fragment is a substring of the statement. */
const OWN_ID = 'keyed by his own id, endpoint or token: random, global, from his session';
const NO_GROUP_ID: Record<string, string> = {
  'depart.ts': OWN_ID,
  'push.ts': OWN_ID,
  'routes/push.ts': OWN_ID,
  'routes/link.ts': 'link and pairing secrets are global random tokens, before any room is known',
  'routes/me.ts': OWN_ID,
  'routes/mine.ts': OWN_ID,
  'room/members.ts': OWN_ID,
  'index.ts:UPDATE members SET last_seen': OWN_ID,
  'routes/auth.ts:UPDATE members SET display_name': OWN_ID,
  'media.ts:DELETE FROM media WHERE id IN': 'ids just read back under a group_id above',
  'prompts.ts:FROM prompts WHERE id = ? AND active':
    'liveness only; promptById below is group-scoped',
  'oops.ts': 'the faults table is the app’s own, not a room’s',
  'routes/ops.ts': 'OPS_SECRET-gated cleanup of the prove room, by marker',
};
const NAME_JOIN = 'a name beside something he wrote or answered; his old words keep his name';
const MEMBERS_UNFILTERED: Record<string, string> = {
  'prompts.ts': NAME_JOIN,
  'room/lines.ts': NAME_JOIN,
  'routes/events.ts': NAME_JOIN,
  'routes/poll.ts': NAME_JOIN,
  'routes/rsvp.ts': NAME_JOIN,
  'routes/search.ts': NAME_JOIN,
  'room/members.ts:SELECT glasses': 'one member by his own id, for his frames',
  'routes/me.ts:SELECT avatar_key': 'one member by his own id and group',
  'routes/link.ts:SELECT 1 AS one':
    'is this device hash taken: a departed dad’s is gone:<id>, never a match',
};
const UNCHUNKED_IN: Record<string, string> = {
  'board.ts': 'weeks: BOARD_WEEKS (six), a constant',
};

const allowed = (list: Record<string, string>, s: Statement) =>
  Object.keys(list).some((k) => {
    const [file, ...frag] = k.split(':');
    return s.file.endsWith(file!) && (frag.length === 0 || s.sql.includes(frag.join(':')));
  });

describe('the Worker’s SQL', () => {
  it('finds statements to audit', () => {
    expect(statements().length).toBeGreaterThan(100);
  });

  it('builds every variable-length IN (…) from chunks()', () => {
    const bad: string[] = [];
    for (const [path, source] of Object.entries(files)) {
      const file = path.replace('../src/worker/', '');
      const lines = source.split('\n');
      lines.forEach((text, i) => {
        if (!/\bIN\s*\(\s*\$\{/.test(text)) return;
        const near = lines.slice(Math.max(0, i - 15), i + 1).join('\n');
        if (/\bchunks\(/.test(near)) return;
        if (Object.keys(UNCHUNKED_IN).some((k) => file.endsWith(k))) return;
        bad.push(`${file}:${i + 1}  ${text.trim()}`);
      });
    }
    expect(bad, 'wrap the ids in chunks(), or explain in UNCHUNKED_IN').toEqual([]);
  });

  it('keys every statement over a group’s table by group_id', async () => {
    // pragma_table_info is not authorized in D1; the stored CREATE text will do.
    const { results } = await env.DB.prepare(
      `SELECT name, sql FROM sqlite_master WHERE type = 'table'`,
    ).all<{ name: string; sql: string }>();
    const grouped = new Set(results.filter((r) => r.sql.includes('group_id')).map((r) => r.name));
    const over = statements().filter((s) => tablesIn(s.sql).some((t) => grouped.has(t)));
    expect(over.length, 'the audit found nothing to audit').toBeGreaterThan(50);
    const bad = over
      .filter((s) => !/group_id/i.test(s.sql) && !allowed(NO_GROUP_ID, s))
      .map((s) => `${s.file}:${s.line}  ${s.sql.replace(/\s+/g, ' ').trim().slice(0, 110)}`);
    expect(bad, 'key it by group_id, or explain in NO_GROUP_ID').toEqual([]);
  });

  it('decides, for every read of members, whether the departed count', () => {
    const bad = statements()
      .filter((s) => /^\s*(SELECT|WITH)/i.test(s.sql) && tablesIn(s.sql).includes('members'))
      .filter((s) => !/gone_at/i.test(s.sql) && !allowed(MEMBERS_UNFILTERED, s))
      .map((s) => `${s.file}:${s.line}  ${s.sql.replace(/\s+/g, ' ').trim().slice(0, 110)}`);
    expect(bad, 'filter gone_at IS NULL, or explain in MEMBERS_UNFILTERED').toEqual([]);
  });
});
