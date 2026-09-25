-- The language an invite speaks: the language of the dad who sent it, when
-- he opened the sheet. Its link preview says who is asking in his words, not
-- in both, and a friend who follows it on a phone that has never chosen
-- lands on the door in the same language. NULL for links minted before this,
-- which keep the bilingual preview they always had.
ALTER TABLE invites ADD COLUMN lang TEXT;
