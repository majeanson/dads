/**
 * Ids in slices D1 can take: it allows about a hundred bound parameters per
 * statement, and a backfill or a resume can name five hundred lines, thirty
 * days of media, or every mark in the tail. Every `IN (...)` built from a
 * list of unknown length is built from one of these, because the one that
 * was not threw while building the hello frame — and a dad whose hello throws
 * reconnects with the same question until he reloads, which from a home
 * screen is never. test/sql-audit.test.ts fails on an unchunked one.
 */
const IN_CHUNK = 80;
export function* chunks<T>(ids: readonly T[]): Generator<T[]> {
  for (let i = 0; i < ids.length; i += IN_CHUNK) yield ids.slice(i, i + IN_CHUNK);
}
