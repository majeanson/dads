/**
 * Which D1 tables `npm run backup` copies, and which it leaves out on purpose.
 *
 * Pure so test/backup.test.ts can hold it against the real schema: a table
 * added by a migration has to land in one list or the other, or the suite
 * fails. A backup that quietly omits the newest table is found out about on
 * the day it is needed.
 */
export const BACKUP_TABLES = [
  'groups',
  'members',
  'messages',
  'media',
  'prompts',
  'prompt_days',
  'check_ins',
  'commitments',
  'presence',
  'rsvps',
  'night_items',
  'night_votes',
  'reactions',
  'invites',
  'push_subscriptions',
  'oops',
  'events',
  'event_rsvps',
  'member_devices',
] as const;

/** Left out on purpose, and why. */
export const NOT_BACKED_UP: Record<string, string> = {
  // Ten-minute, one-use secrets: a restored one would be expired anyway.
  device_links: 'ten-minute one-use link secrets',
  device_pairs: 'ten-minute one-use pairing codes',
  // Throttle buckets keyed on an HMAC of an address; nothing to preserve.
  join_attempts: 'throttle buckets, expire in minutes',
  // What links say about themselves; a page is asked again when its row expires.
  link_previews: 'link preview cache, fetched again on demand',
};
