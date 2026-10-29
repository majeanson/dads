-- Retention for the two tables that only ever grew.
--
-- `join_attempts` keeps one row per distinct address, ever; every window it
-- counts over is a day at most, so a row older than a day says nothing. The
-- delete that now rides on each write finds them by this index instead of
-- reading the table.
--
-- `presence` already has (group_id, created_at), which is what its prune uses.

CREATE INDEX join_attempts_by_window ON join_attempts(window_start);
