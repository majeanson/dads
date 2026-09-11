-- A dad gets a face, and can change the name he goes by.
--
-- The blob lives in R2 under a key held here, NOT in the `media` table — a
-- face is not a photograph posted to the room and must never count against
-- the ten-picture shelf or be pruned off it. It also replaces rather than
-- accumulates: one key per dad, overwritten, so a group of five owns five
-- objects for ever however many times they change them.
--
-- `avatar_at` is the version. It rides in the roster and goes on the end of
-- the URL, which is what lets the face be cached for a year and still change
-- the moment a dad sets a new one.
ALTER TABLE members ADD COLUMN avatar_key TEXT;
ALTER TABLE members ADD COLUMN avatar_at INTEGER;
