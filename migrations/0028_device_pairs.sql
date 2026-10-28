-- Asking to be let in as a dad that already exists, from the NEW device.
--
-- A home-screen app on an iPhone has storage of its own: it cannot open a
-- link that was made in Safari. So the new device asks, shows a short code,
-- and a device that already is him types it in. Both halves are HMACs, as
-- `device_links` are; `member_id` stays NULL until a device has said yes.
CREATE TABLE device_pairs (
  code_hash  TEXT PRIMARY KEY,
  poll_hash  TEXT NOT NULL UNIQUE,
  group_id   TEXT REFERENCES groups(id) ON DELETE CASCADE,
  member_id  TEXT REFERENCES members(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
