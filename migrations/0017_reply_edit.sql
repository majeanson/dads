-- A line may answer another, and a line may be changed by the man who typed it.
--
-- `reply` is a SNAPSHOT of what he was answering — {id, name, body} as JSON —
-- not a reference. The original may scroll out of the backfill, be taken back,
-- or be edited afterwards, and the quote should still say what he was
-- answering at the time: that is what a reply means in every chat anyone has
-- used. `edited_at` is the one fact about an edit worth keeping; the words
-- before it are not, because the whole point of editing is that they were
-- wrong.
ALTER TABLE messages ADD COLUMN reply TEXT;
ALTER TABLE messages ADD COLUMN edited_at INTEGER;
