-- A line put on the list of recommendations by hand.
--
-- The list is mostly a view of lines that hold a link from a known site, and
-- that needs no row. This is for the rest: a title with no address, a short
-- link the classifier cannot read (amzn.to), a book somebody only named. The
-- category is the dad's word and beats the classifier's.
--
-- One row per line, and the first dad to add it keeps it (INSERT OR IGNORE).
-- message_id cascades, so a line taken back leaves the list with it, by the
-- same route reactions use; group_id cascades with the room.
CREATE TABLE line_picks (
  message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  member_id  TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  category   TEXT NOT NULL CHECK (category IN ('watch', 'listen', 'read')),
  created_at INTEGER NOT NULL
);
CREATE INDEX line_picks_by_group ON line_picks(group_id);
