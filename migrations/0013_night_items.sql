-- What we should get into.
--
-- The standing night got the dads to the table; it never said what they were
-- there to talk about. In practice a man thinks of the thing he wants to ask
-- on Tuesday morning and it is gone by Thursday evening, and the evening turns
-- into whatever the loudest of them brings up.
--
-- So the week has somewhere to put it. Keyed on the OCCURRENCE like an RSVP —
-- the instant the evening starts, computed by the server — so a thought had on
-- Tuesday belongs to Thursday, and one had at ten past nine belongs to the
-- evening happening around it.
--
-- No status, no owner but the man who wrote it, no ticking off. This is a list
-- to look at together, not a backlog to work.
CREATE TABLE night_items (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  member_id  TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  occurrence INTEGER NOT NULL,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX night_items_by_night ON night_items(group_id, occurrence, created_at);
