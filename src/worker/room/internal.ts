import type { DadNight } from '../../shared/dadNight';
import type { RoomsOpen } from '../../shared/protocol';
import { noteChange } from './changes';
import { forget } from './lines';
import { restamp } from './members';
import { applyNight } from './night';
import type { Room } from './room';
import { rescheduleAlarm } from './schedule';

const done = () => new Response(null, { status: 204 });

/**
 * The paths only the Worker can reach: something changed in D1, and the
 * sockets open on this room should hear it. Null for anything else, which
 * is then a socket upgrade or nothing.
 */
export async function internalRoute(
  room: Room,
  request: Request,
  url: URL,
): Promise<Response | null> {
  if (url.pathname === '/health') {
    return Response.json({ ok: true, id: room.ctx.id.toString() });
  }
  if (request.method !== 'POST') return null;

  switch (url.pathname) {
    // The group's night changed while dads were connected.
    case '/night': {
      const { night } = (await request.json()) as { night: DadNight | null };
      applyNight(room, night);
      room.broadcast({ t: 'night', night });
      await rescheduleAlarm(room);
      return done();
    }

    // Somebody marked the calendar that picks the next night. A nudge to
    // re-read, nothing more: see the `poll` frame in protocol.ts.
    case '/poll':
      room.broadcast({ t: 'poll' });
      return done();

    // A screen that reads over HTTP should look again. See the `stir` frame
    // in protocol.ts for why it exists.
    case '/stir': {
      const { what } = (await request.json()) as { what: 'night' | 'todo' | 'table' };
      if (what !== 'night' && what !== 'todo' && what !== 'table') {
        return new Response('bad stir', { status: 400 });
      }
      room.broadcast({ t: 'stir', what });
      return done();
    }

    // What the group has open changed. Nothing is said in the conversation —
    // a switch is not news — but every open room finds out at once.
    case '/rooms': {
      const rooms = (await request.json()) as RoomsOpen;
      room.broadcast({ t: 'rooms', rooms });
      return done();
    }

    // The room changed hands. Nothing is said here — the route says it, by
    // name, like the night — this only carries the fact to open phones.
    case '/owner': {
      const { createdBy } = (await request.json()) as { createdBy: string | null };
      room.broadcast({ t: 'owner', createdBy });
      return done();
    }

    // A picture was taken off the shelf, or put back on it. Nothing is said —
    // keeping a photograph is not news, the same as a face changing — but
    // whether it survives the next upload is a fact about the room, so every
    // open phone hears it rather than only the one that asked. The Worker has
    // already written it to D1.
    case '/kept': {
      const { mediaId, on } = (await request.json()) as { mediaId: string; on: boolean };
      const rev = noteChange(room, 'media', mediaId);
      room.broadcast({ t: 'kept', mediaId, on, rev });
      return done();
    }

    // Pictures an upload pushed off the shelf. The Worker has deleted them;
    // every open phone is still showing them, and only the uploader was told.
    case '/unshelved': {
      const { mediaIds } = (await request.json()) as { mediaIds: string[] };
      if (mediaIds.length === 0) return done();
      let rev = 0;
      for (const id of mediaIds) rev = noteChange(room, 'media', id);
      room.broadcast({ t: 'unshelved', mediaIds, rev });
      return done();
    }

    // A dad changed his name or his face; see `restamp`.
    case '/member': {
      const { groupId, memberId, name, face } = (await request.json()) as {
        groupId: string;
        memberId: string;
        name: string;
        face: number | null;
        was?: string;
      };
      // The object learns its group id from a socket upgrade, and this can be
      // the first thing it ever hears — a dad who renames himself before any
      // connection would otherwise get a line the archive never sees.
      room.learnGroup(groupId);
      await restamp(room, memberId, name, face);
      return Response.json({ ok: true });
    }

    // Lines taken out of the tail by pattern; see `forget`.
    case '/forget': {
      const { like } = (await request.json()) as { like?: unknown };
      if (typeof like !== 'string' || like.length < 4 || like.length > 200) {
        return new Response('bad pattern', { status: 400 });
      }
      return Response.json({ dropped: forget(room, like) });
    }
  }
  return null;
}
