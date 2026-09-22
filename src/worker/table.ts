import { deriveTableCode, freshTableCode, isValidTableCode } from '../shared/jaffre';
import type { Env } from './env';

/**
 * Move the group to a table nobody has sat at.
 *
 * The stored code is simply replaced: `tableCodeFor` reads it back from here
 * on, and every open screen is told to fetch it again. Nothing on jaffre's
 * side is touched — the old room empties and its own reaper collects it.
 */
export async function newTableFor(env: Env, group: { id: string; slug: string }): Promise<string> {
  // Hex, not randomToken: base64url's `-` and `_` are filtered out of a code,
  // and a suffix must never come up short.
  const random = [...crypto.getRandomValues(new Uint8Array(4))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const code = freshTableCode(group.slug, random);
  await env.DB.prepare('UPDATE groups SET jaffre_room_code = ? WHERE id = ?')
    .bind(code, group.id)
    .run();
  return code;
}

/**
 * The group's table code.
 *
 * Derived from the slug the first time anyone opens the table, then written to
 * the group and read back forever after. Deriving it every time would be
 * simpler and wrong: change the derivation, or rename a group, and the dads
 * would silently walk into an empty room.
 */
export async function tableCodeFor(env: Env, group: { id: string; slug: string }): Promise<string> {
  const row = await env.DB.prepare('SELECT jaffre_room_code FROM groups WHERE id = ?')
    .bind(group.id)
    .first<{ jaffre_room_code: string | null }>();

  const stored = row?.jaffre_room_code;
  if (stored && isValidTableCode(stored)) return stored;

  const code = deriveTableCode(group.slug);
  // Only claim it if nobody else did in the meantime.
  await env.DB.prepare(
    'UPDATE groups SET jaffre_room_code = ? WHERE id = ? AND jaffre_room_code IS NULL',
  )
    .bind(code, group.id)
    .run();

  const settled = await env.DB.prepare('SELECT jaffre_room_code FROM groups WHERE id = ?')
    .bind(group.id)
    .first<{ jaffre_room_code: string | null }>();
  return settled?.jaffre_room_code ?? code;
}
