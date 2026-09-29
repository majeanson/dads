-- A dad who left the room, or was taken out of it (2026-09-29).
--
-- Marked, never deleted: his lines, his marks and his weeks are the group's
-- history, and deleting the row would take his name off every one of them
-- (the archive joins members for it) and cascade away his check-ins and
-- promises. NULL is a dad who is still here. A gone dad's session and device
-- token stop working, and he drops out of everything that means "the men in
-- this room" — the roster, the pickers, the board's empty rows — while his
-- face stays beside what he said.
ALTER TABLE members ADD COLUMN gone_at INTEGER;
