-- One tap, so being present on a night you have nothing to add does not cost
-- a whole line.
--
-- In D1 and not in the room's tail, like everything that has to outlive an
-- eviction. The room broadcasts a change the moment it lands, and a
-- reconnecting dad has his hydrated from here alongside the attachments.
--
-- The primary key is the whole row: one dad, one message, one mark, and
-- pressing the same one twice takes it off rather than stacking it up.
-- message_id cascades, so a line taken back takes its marks with it — which
-- is the behaviour the retract path relies on rather than doing by hand.
CREATE TABLE reactions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  member_id  TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  -- Checked against a short allowlist in the Worker before it ever gets here;
  -- this column is not a place for arbitrary text from a browser.
  emoji      TEXT NOT NULL,
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, member_id, emoji)
);
CREATE INDEX reactions_by_message ON reactions(message_id);
