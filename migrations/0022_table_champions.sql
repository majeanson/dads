-- Who won the last game at the table (2026-09-24).
--
-- JSON {ids, at}: the member ids jaffre named as winners (game-over's
-- `winners`, joined on the name jaffre was handed, like a turn nudge), and
-- when. Their glasses go gold on every face of theirs until the next game ends
-- — which replaces it, or clears it when no human won — or for a week, which
-- the client works out from `at`. NULL: nobody has won anything yet.
ALTER TABLE groups ADD COLUMN champions TEXT;
