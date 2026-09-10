-- A link a dad can send.
--
-- The invite code is a passphrase five friends say out loud, and it is stored
-- only as a PBKDF2 hash — deliberately, so a dump of `groups` hands nobody the
-- door. That also means the app CANNOT put the code in a link: it does not
-- know it. So a link carries its own secret instead.
--
-- 256 random bits, HMAC'd at rest for the same reason device tokens are: the
-- token is the credential, and a copy of this table should be worth nothing.
-- Any dad may mint one, like the night and the room switches; it lasts a week,
-- and it works for as many dads as he sends it to, because a link that only
-- lets one man in is a link that quietly fails for the second.
CREATE TABLE invites (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX invites_by_group ON invites(group_id, expires_at);
