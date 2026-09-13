-- A photograph can be kept, and then the shelf cannot have it.
--
-- The cap is still the feature: ten pictures to a room, thirty voice notes,
-- and past either the oldest of that kind goes, blob and record together. But
-- the thing that goes is a photograph of somebody's child, and "this is a
-- place to show somebody a picture, not to keep one" is the right default and
-- the wrong absolute. One tap takes a picture off the shelf.
--
-- Kept media is exempt from the pruner and counted on its own, so a group
-- cannot keep its way to an unbounded bucket — see KEPT_PER_GROUP. Any dad
-- may keep any of it and any dad may let it go, like the night and the three
-- switches: two men disagreeing about whether a photo survives is not a thing
-- five friends need a permission model for.
ALTER TABLE media ADD COLUMN kept INTEGER NOT NULL DEFAULT 0;

-- The pruner asks for the unkept of one kind, newest first; the keep route
-- counts the kept. Both are this index.
CREATE INDEX media_by_group_kept ON media(group_id, kept, created_at);
