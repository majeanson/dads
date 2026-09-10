-- Dad-night reminders, per device, per dad who asked for one.
--
-- One row per browser that said yes: a dad with a phone and a laptop has two,
-- and each is a separate promise he made on that device. The endpoint is the
-- primary key because that is what the push service itself uses as the
-- identity of a subscription, and re-subscribing on the same browser yields
-- the same one.
--
-- Nothing here is readable by us: p256dh and auth are the browser's own keys
-- for encrypting a payload to itself. What we can do is send; what we cannot
-- do is see anything about the device beyond a URL its browser handed us.
CREATE TABLE push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  member_id  TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX push_by_group ON push_subscriptions(group_id);
CREATE INDEX push_by_member ON push_subscriptions(member_id);
