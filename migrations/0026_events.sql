-- Other nights than the dad night (2026-10-27).
--
-- Dad night is the standing mechanism and stays exactly what it is. But a
-- group of men also bowls, or fires up a barbecue, or goes to a game, and
-- those happen ONCE, on a date somebody has to put somewhere. Until now that
-- happened in some other app and the room found out afterwards.
--
-- An event is a one-off: a title, a place if there is one, a civil date and a
-- wall-clock time in the zone the group was in when it was made — never a
-- timestamp as the source of truth, for the same reason dad night is not
-- (21:00 is 21:00 whatever the offset is doing that week). `starts_at` is the
-- derived instant, kept only so the list sorts and the room's one alarm has
-- something to arm; it is recomputed from day, time and tz on every edit.
--
-- Any dad makes one; only the dad who made it edits or cancels it. A departed
-- dad's events stay (`gone_at` is a mark, not a delete) and stay his.
--
-- `reminded_at` and `started_at` are the two pushes an event owes the phones
-- that asked. They are stamped when sent so a restarted object cannot send
-- either twice, and an event made less than a day out is stamped as reminded
-- at birth: "tomorrow" about something happening in three hours is wrong.
CREATE TABLE events (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  member_id   TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  place       TEXT NOT NULL DEFAULT '',
  day         TEXT NOT NULL,
  time        TEXT NOT NULL,
  tz          TEXT NOT NULL,
  starts_at   INTEGER NOT NULL,
  reminded_at INTEGER,
  started_at  INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE INDEX events_by_start ON events(group_id, starts_at);

-- The same three answers as the night. Keyed on the event, so cancelling one
-- takes its answers with it.
CREATE TABLE event_rsvps (
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id  TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  answer     TEXT NOT NULL CHECK (answer IN ('in', 'maybe', 'out')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, member_id)
);
