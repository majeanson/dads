-- Photos and files shared in the room.
--
-- The blob lives in R2; this is the record of what it is, who put it there and
-- when. A room keeps the ten most recent and the oldest silently falls off —
-- see MEDIA_PER_GROUP. That cap is the whole design: this is a place to show
-- somebody a picture, not a place to store one.
CREATE TABLE media (
  id           TEXT PRIMARY KEY,
  group_id     TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  member_id    TEXT REFERENCES members(id) ON DELETE SET NULL,
  -- Where it sits in the bucket. Kept explicitly rather than derived, so the
  -- key format can change without orphaning everything already stored.
  r2_key       TEXT NOT NULL,
  name         TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL,
  -- Known for images, null otherwise: lets the room reserve the right shape
  -- before the bytes arrive, so the conversation does not jump as it loads.
  width        INTEGER,
  height       INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE INDEX media_by_group ON media(group_id, created_at);

-- A message carries an attachment rather than being one: a dad sending a photo
-- is still a dad talking, and the caption is the message body. Adding a new
-- `kind` would have meant rebuilding the table to widen its CHECK constraint,
-- for no gain.
ALTER TABLE messages ADD COLUMN media_id TEXT REFERENCES media(id) ON DELETE SET NULL;
