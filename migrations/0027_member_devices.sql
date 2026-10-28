-- One dad on more than one device.
--
-- A device token identifies a browser, and `members.device_token_hash` holds
-- ONE of them, so a second phone joining with the same name became a second
-- dad with an empty profile. This is the other devices, added only by a link
-- minted from a device that is already him: nothing here is found by name.
--
-- Both tables hold HMACs, never the token, for the same reason `invites` do.
CREATE TABLE member_devices (
  token_hash TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  member_id  TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX member_devices_by_member ON member_devices(member_id);

-- A link that carries one device to him: ten minutes, one use.
CREATE TABLE device_links (
  token_hash TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  member_id  TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- The colour a dad picked for himself, one of the six in `dadColour.ts`.
-- NULL keeps the one his id hashes to.
ALTER TABLE members ADD COLUMN colour INTEGER;
