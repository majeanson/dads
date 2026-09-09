-- dads v1 schema.
--
-- Everything here is durable state that must survive a Durable Object being
-- evicted. Live state (who is connected right now, typing indicators, the
-- in-flight websocket buffer) lives in the RoomDO and is deliberately absent.
--
-- Multi-group from day one: every row is keyed by group_id even though v1
-- shows a single group. Adding a second group must never be a migration.

CREATE TABLE groups (
  id               TEXT PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  -- Argon-ish is overkill for a shared passphrase typed by five friends, but
  -- the plaintext must never sit in the database: SHA-256 over code + salt.
  invite_code_hash TEXT NOT NULL,
  invite_code_salt TEXT NOT NULL,
  -- Dad night: 0=Sunday..6=Saturday, "HH:MM" local to dad_night_tz (IANA).
  -- Stored as parts, not a timestamp, because it is a recurring social slot
  -- and must survive DST without drifting an hour.
  dad_night_weekday INTEGER,
  dad_night_time    TEXT,
  dad_night_tz      TEXT NOT NULL DEFAULT 'America/Montreal',
  -- The Jaffre room code this group always plays in, so the table is the same
  -- table every week. NULL until the group first opens it.
  jaffre_room_code TEXT,
  created_at       INTEGER NOT NULL
);

CREATE TABLE members (
  id                TEXT PRIMARY KEY,
  group_id          TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  display_name      TEXT NOT NULL,
  -- HMAC of the device token in the signed cookie. Lets a dad come back on the
  -- same device silently, without the app ever storing anything reversible.
  device_token_hash TEXT NOT NULL,
  joined_at         INTEGER NOT NULL,
  last_seen         INTEGER NOT NULL
);
CREATE INDEX members_by_group ON members(group_id);
CREATE UNIQUE INDEX members_by_device ON members(group_id, device_token_hash);

-- Chat archive. The DO owns the live tail; this is the record that survives it.
CREATE TABLE messages (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  member_id  TEXT REFERENCES members(id) ON DELETE SET NULL,
  -- chat        — a dad typed it
  -- system      — joins, leaves, dad-night markers
  -- prompt      — answer to the day's prompt, rendered distinctly
  -- table       — relayed from the Jaffre iframe ("Marc took the table")
  kind       TEXT NOT NULL CHECK (kind IN ('chat', 'system', 'prompt', 'table')),
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX messages_by_group_time ON messages(group_id, created_at);

-- Prompt pool. group_id NULL = the curated global set shipped with the repo;
-- a non-null group_id is one a dad submitted for his own group.
CREATE TABLE prompts (
  id               TEXT PRIMARY KEY,
  group_id         TEXT REFERENCES groups(id) ON DELETE CASCADE,
  body             TEXT NOT NULL,
  author_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  active           INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL
);
CREATE INDEX prompts_by_group ON prompts(group_id, active);

-- Which prompt a group got on a given day. Written once on first read of the
-- day and never recomputed: the pick is deterministic, but the pool changes
-- when a dad submits one, and yesterday's question must not silently rewrite
-- itself underneath the answers already attached to it.
CREATE TABLE prompt_days (
  group_id  TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  day       TEXT NOT NULL,          -- 'YYYY-MM-DD' in the group's tz
  prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, day)
);

-- Weekly check-in: a 1-5 and one line. Group-visible by design.
CREATE TABLE check_ins (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  member_id  TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  week       TEXT NOT NULL,         -- ISO week, 'YYYY-Www'
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  note       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX check_ins_one_per_week ON check_ins(group_id, member_id, week);

-- One concrete thing to try this week, and whether it happened.
CREATE TABLE commitments (
  id           TEXT PRIMARY KEY,
  group_id     TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  member_id    TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  week         TEXT NOT NULL,       -- ISO week, 'YYYY-Www'
  body         TEXT NOT NULL,
  outcome      TEXT NOT NULL DEFAULT 'pending'
                 CHECK (outcome IN ('pending', 'done', 'missed')),
  reflection   TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  reflected_at INTEGER
);
CREATE UNIQUE INDEX commitments_one_per_week ON commitments(group_id, member_id, week);
