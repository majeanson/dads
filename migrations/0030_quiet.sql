-- Quiet hours and snooze for push, per dad (2026-10-29).
--
-- Per DAD and not per device, the way a snooze in Google Chat follows the man
-- to every phone he has: a dad who says "not tonight" does not mean one of
-- his two phones. A pause is an instant; a window is two wall-clock times in
-- the zone his own phone reported when he set it (his, not the room's: the
-- room's night can be in another zone from the man who is silencing it).
--
-- All four are NULL for every dad who has never touched them: no window, no
-- pause, and the push goes out exactly as it did.

ALTER TABLE members ADD COLUMN quiet_from TEXT;
ALTER TABLE members ADD COLUMN quiet_to TEXT;
ALTER TABLE members ADD COLUMN quiet_tz TEXT;
ALTER TABLE members ADD COLUMN snoozed_until INTEGER;
