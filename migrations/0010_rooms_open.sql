-- What this group has open.
--
-- Not every group wants all of it. A group that never fills in the week should
-- not carry a button for it, and a group that does not play cards should not
-- carry a table. Three switches, on by default, and any dad may change them —
-- the same rule as dad night, because there is no admin here and inventing one
-- for three switches would be inventing one.
--
-- Group-level and not per dad: what a room has in it is the room's, and two
-- dads seeing different menus is how a group stops sharing a room.
ALTER TABLE groups ADD COLUMN questions_on INTEGER NOT NULL DEFAULT 1;
ALTER TABLE groups ADD COLUMN week_on INTEGER NOT NULL DEFAULT 1;
ALTER TABLE groups ADD COLUMN table_on INTEGER NOT NULL DEFAULT 1;
