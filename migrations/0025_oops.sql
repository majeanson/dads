-- What went wrong, said by the app rather than by a dad (2026-10-01).
--
-- Three dads, one of them opening the room on a given day: nobody is going to
-- write in to say the photo did not send. The Worker, the room and every
-- phone write here instead, and `npm run oops` reads it.
--
-- No foreign keys on purpose: a report must never fail to land because the
-- thing it is about is gone, and a group or a member here is a clue, not a
-- relation. Never what a dad typed — a message, a code, a fact; the user
-- agent so an iPhone can be told from an Android. Pruned at 30 days on write.
CREATE TABLE oops (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        INTEGER NOT NULL,
  side      TEXT    NOT NULL CHECK (side IN ('worker', 'room', 'web')),
  what      TEXT    NOT NULL,
  message   TEXT    NOT NULL,
  detail    TEXT,
  group_id  TEXT,
  member_id TEXT,
  build     TEXT,
  agent     TEXT
);

CREATE INDEX oops_at ON oops (at);
CREATE INDEX oops_member_at ON oops (member_id, at);
