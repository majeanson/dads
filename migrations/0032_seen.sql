-- Where a dad got to in the conversation, on the man and not the phone
-- (Marc asked, 2026-11-02).
--
-- The mark the "N new" count, the divider, the tab title and the icon's badge
-- are all derived from used to live only in each phone's localStorage, so a
-- dad who read everything on his phone came home to a laptop that still said
-- twelve new. Both his devices are ONE member row (a second device is added
-- by link or code), so the mark belongs on that row.
--
-- The `seq` of the newest line he has looked at, on any of his devices. NULL
-- is a dad who has never marked anything. It only ever goes forward, and it
-- is read only by his own sockets: nobody else is told what he has read.

ALTER TABLE members ADD COLUMN seen_seq INTEGER;
