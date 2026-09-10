-- Who is actually coming.
--
-- The standing night was the whole mechanism: a slot everybody knows about,
-- announced and summarised in the room. What it could not answer was the
-- question a man asks himself on Thursday afternoon — is anyone else going to
-- be there? Turnout is the product, and a night nobody has said yes to is a
-- night everybody quietly skips.
--
-- Keyed on the OCCURRENCE, not the week: the instant the night starts, which
-- the server computes from the group's slot so two phones with different
-- clocks cannot disagree about which evening they are answering. One row per
-- dad per evening; changing your mind rewrites it.
CREATE TABLE rsvps (
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  member_id  TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  occurrence INTEGER NOT NULL,
  answer     TEXT NOT NULL CHECK (answer IN ('in', 'out')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, member_id, occurrence)
);

CREATE INDEX rsvps_by_night ON rsvps(group_id, occurrence);
