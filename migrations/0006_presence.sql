-- Comings and goings, out of the conversation.
--
-- "Marc came in" / "Marc left" used to be `messages` rows, which meant that in
-- a group of five on phones that switch networks, most of the archive was the
-- room announcing the room. Presence is not something anybody said; it belongs
-- beside the roster, where a dad goes when he actually wants to know who has
-- been about — the header's "3 here" opens it.
--
-- Still D1 and not DO storage: it must outlive an eviction like everything
-- else worth reading tomorrow.
CREATE TABLE presence (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  -- Kept by name as well as by id: a member row can go, and "someone came in"
  -- is not a thing worth keeping.
  member_id  TEXT REFERENCES members(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('in', 'out')),
  created_at INTEGER NOT NULL
);
CREATE INDEX presence_by_group_time ON presence(group_id, created_at);
