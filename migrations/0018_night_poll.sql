-- Picking the next one, when it is not always the same night.
--
-- The standing slot was the whole mechanism and it is still the best one: a
-- night everybody already knows about needs nobody to organise it. But a slot
-- is an answer to "when", and some groups cannot give that answer once and
-- have it hold — a shift, a hockey season, a baby. For them the night had to
-- be arranged, and this app had nowhere to arrange it, so it happened in some
-- other app and the room found out afterwards.
--
-- Two halves:
--
-- `dad_night_date` is a night that happens ONCE. It is still a civil date and
-- a wall-clock time in the group's zone, never a timestamp, for exactly the
-- reason the weekly slot is: 21:00 is 21:00 whatever the offset is doing that
-- week. A night with a date does not repeat; a night without one does. That
-- one column is the "always the same day" switch — a night that repeats has
-- no particular date, and a one-off has exactly one, so there is nothing to
-- keep in step.
--
-- `night_votes` is the calendar. Any dad marks the days he can do, on a month
-- he can page forward through as far as he likes; the day with the most dads
-- on it is the obvious answer, and any dad locks it in. Keyed on the DAY
-- rather than on a poll, because "is there a poll open" is a question this
-- app already answers: there is no night still to come. Locking one in clears
-- the lot, so a round never bleeds into the next.
ALTER TABLE groups ADD COLUMN dad_night_date TEXT;

CREATE TABLE night_votes (
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  member_id  TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  -- "YYYY-MM-DD" as the group's own calendar reads it.
  day        TEXT NOT NULL,
  answer     TEXT NOT NULL CHECK (answer IN ('in', 'maybe', 'out')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, member_id, day)
);

CREATE INDEX night_votes_by_day ON night_votes(group_id, day);

-- And the RSVP learns the same third answer.
--
-- "In" and "can't" were the two a standing night needs: it is Thursday, you
-- either are coming or you are not. A night being ARRANGED asks the question
-- differently — a man often genuinely does not know yet, and forcing that into
-- "can't" loses the date for everybody, while forcing it into "in" is a
-- promise he did not make. SQLite cannot widen a CHECK in place, so the table
-- is rebuilt; every existing row copies across untouched.
CREATE TABLE rsvps_next (
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  member_id  TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  occurrence INTEGER NOT NULL,
  answer     TEXT NOT NULL CHECK (answer IN ('in', 'maybe', 'out')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, member_id, occurrence)
);

INSERT INTO rsvps_next (group_id, member_id, occurrence, answer, updated_at)
  SELECT group_id, member_id, occurrence, answer, updated_at FROM rsvps;

DROP TABLE rsvps;

ALTER TABLE rsvps_next RENAME TO rsvps;

CREATE INDEX rsvps_by_night ON rsvps(group_id, occurrence);
