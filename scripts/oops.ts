import { query } from './d1';

/**
 * What went wrong lately, as the app wrote it down (D1 `oops`).
 *
 *   npm run oops                 the last 7 days, grouped
 *   npm run oops -- --days 30    further back (the table keeps 30)
 *   npm run oops -- --all        every report, newest first, with its stack
 *   npm run oops -- --local      the local database instead
 *
 * Grouped by where and what, because one phone in a dead spot says the same
 * thing twenty times and the question is "what kinds of thing", not "how
 * many". The room's name is printed so the Prove Room's own noise can be told
 * from a real dad's.
 */

const args = process.argv.slice(2);
const remote = !args.includes('--local');
const all = args.includes('--all');
const daysAt = args.indexOf('--days');
const days = daysAt >= 0 ? Number(args[daysAt + 1]) : 7;
if (!Number.isFinite(days) || days <= 0) {
  console.error('--days takes a number of days');
  process.exit(1);
}
const since = Date.now() - days * 24 * 60 * 60 * 1000;

const when = (ms: unknown) => new Date(Number(ms)).toISOString().slice(0, 16).replace('T', ' ');
const device = (agent: unknown) => {
  const a = String(agent ?? '');
  if (/iPhone|iPad/.test(a)) return 'iPhone';
  if (/Android/.test(a)) return 'Android';
  if (/Macintosh/.test(a)) return 'Mac';
  if (/Windows/.test(a)) return 'Windows';
  return a ? 'other' : '-';
};

if (all) {
  const rows = query(
    `SELECT o.at, o.side, o.what, o.message, o.detail, o.build, o.agent, g.name AS room
     FROM oops o LEFT JOIN groups g ON g.id = o.group_id
     WHERE o.at > ${since} ORDER BY o.at DESC LIMIT 200`,
    remote,
  );
  for (const r of rows) {
    console.log(
      `\n${when(r.at)}  ${r.side}  ${r.what}  [${r.room ?? 'no room'}, ${device(r.agent)}]`,
    );
    console.log(`  ${r.message}`);
    if (r.build) console.log(`  build ${r.build}`);
    if (r.detail) console.log(String(r.detail).replace(/^/gm, '    '));
  }
  if (rows.length === 0) console.log(`Nothing in the last ${days} days.`);
} else {
  const rows = query(
    `SELECT o.side, o.what, o.message, COUNT(*) AS n,
            MIN(o.at) AS first, MAX(o.at) AS last,
            COUNT(DISTINCT o.member_id) AS dads,
            GROUP_CONCAT(DISTINCT g.name) AS rooms,
            MAX(o.agent) AS agent
     FROM oops o LEFT JOIN groups g ON g.id = o.group_id
     WHERE o.at > ${since}
     GROUP BY o.side, o.what, o.message
     ORDER BY last DESC`,
    remote,
  );
  if (rows.length === 0) {
    console.log(`Nothing went wrong that the app noticed in the last ${days} days.`);
  } else {
    for (const r of rows) {
      console.log(`\n${r.n}×  ${r.side}  ${r.what}`);
      console.log(`  ${r.message}`);
      console.log(
        `  ${when(r.first)} → ${when(r.last)}, ${r.dads} dad(s), ${r.rooms ?? 'no room'}, e.g. ${device(r.agent)}`,
      );
    }
    console.log(
      `\n${rows.length} kind(s) in the last ${days} days. --all for each one with its stack.`,
    );
  }
}
