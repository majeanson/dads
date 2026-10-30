-- What a link says about itself, kept for a while (2026-10-30).
--
-- A line with a link in it gets a card under it — the page's title, a line of
-- its description and its picture, the way every chat app does it. The Worker
-- fetches the page's own tags (og:*, twitter:*, <title>) so no dad's phone
-- ever asks the linked site for anything; the picture is served through the
-- Worker too.
--
-- A cache, not a record: global across rooms (a page says the same thing to
-- everyone), keyed by a hash of the address, and a row past `expires_at` is
-- fetched again. A page with nothing to say is a row with a NULL title, kept
-- for a day so a dead link is not asked again by every phone that draws it.
-- Rows past their time are deleted on the next write, as `oops` does.

CREATE TABLE link_previews (
  url_hash TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  image_url TEXT,
  site TEXT,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX link_previews_by_expiry ON link_previews(expires_at);
