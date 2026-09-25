import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { isChampion, type Champions, type RosterEntry } from '../shared/protocol';

/**
 * Everyone in the group, for any face that needs to know what he looks like.
 *
 * A face's picture and his glasses used to be handed down as `faceOf` and
 * `glassesOf` through seven components that did nothing with them but pass
 * them on — and a face drawn anywhere the pair did not reach was a stale face
 * (a photo just chosen in Settings, bare, until the sheet was reopened). Now
 * `Face` asks here by member id, so every face on every screen is the same
 * face, from the one list the room keeps current off `hello` and `member`.
 *
 * `members`, not the roster: a line said on Tuesday by a man who is not here
 * tonight still has his face beside it.
 */
const Members = createContext<ReadonlyMap<string, RosterEntry>>(new Map());
/** Who won the last game at the table. Beside the members, for the same
 * reason: any face anywhere may belong to one of them. */
const Crowned = createContext<Champions | null>(null);

export function MembersProvider({
  members,
  champions = null,
  children,
}: {
  members: RosterEntry[];
  champions?: Champions | null;
  children: ReactNode;
}) {
  const byId = useMemo(() => new Map(members.map((m) => [m.memberId, m])), [members]);
  return (
    <Members.Provider value={byId}>
      <Crowned.Provider value={champions}>{children}</Crowned.Provider>
    </Members.Provider>
  );
}

/** Who won the last game at the table, for a list that asks about several. */
export function useChampions(): Champions | null {
  return useContext(Crowned);
}

/** Whether this dad won the last game — and it was within the week. */
export function useCrowned(memberId: string): boolean {
  return isChampion(useContext(Crowned), memberId, Date.now());
}

/** One dad, or undefined for an id the room has not told us about. */
export function useMember(memberId: string): RosterEntry | undefined {
  return useContext(Members).get(memberId);
}
