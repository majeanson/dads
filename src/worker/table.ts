import { deriveTableCode, isValidTableCode } from '../shared/jaffre';
import type { Env } from './env';

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
