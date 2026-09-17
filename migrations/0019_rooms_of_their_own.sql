-- Anybody can open a room, and the man who opened it owns its switches.
--
-- Two decisions, taken 2026-09-17, and each reverses something written down:
--
-- 1. Group creation was "a seeded script/CLI, not a public flow" (PLAN.md).
--    It is a door now. That makes this app open to anyone who finds it, so
--    creation is rate-limited per IP like a wrong code is, and the word a
--    room is joined with has to be unique across every room — see below.
--
-- 2. "There is no admin in a room" was the rule in five places. It still is
--    for the night, the board, the poll and keeping a photograph — the things
--    a group decides together. The three switches are the creator's now,
--    because they decide what the room IS, and a room somebody made for a
--    purpose should not have that purpose changed by whoever wandered in.
--
-- `created_by` NULL means exactly what it meant before this existed: nobody's
-- room, everybody's switches. Every group that predates this keeps that, and
-- that is the right answer for them rather than a migration picking an owner.
ALTER TABLE groups ADD COLUMN created_by TEXT REFERENCES members(id) ON DELETE SET NULL;

-- The word, as a fingerprint that can be looked up.
--
-- Joining used to SCAN the groups table and run a 100,000-iteration PBKDF2
-- against each row until one matched, capped at fifty. With one room that is
-- one derivation. With rooms anybody can make it is two failures waiting to
-- happen: past the fiftieth room a dad with a PERFECTLY GOOD word is told it
-- opens nothing, because his room was never tested — and every wrong guess
-- costs the Worker fifty derivations instead of one.
--
-- So the normalized word is also stored HMAC'd with the Worker's secret, the
-- way an IP and a device token already are. That is one indexed lookup from a
-- typed word to its room, and PBKDF2 still does the verifying afterwards —
-- this only says WHICH row to verify against. The secret is what keeps it
-- from being a plain dictionary of everyone's words.
--
-- UNIQUE because two rooms sharing a word is not a thing that can be allowed
-- to happen quietly: the scan used to hand the typist whichever room came
-- first, so the second room's dads could type the right word forever and land
-- in a room full of strangers. Now the second room cannot be made.
--
-- NULL for every group that predates this, which is why the scan survives as
-- a fallback: those rooms have no fingerprint and their dads must still get in.
ALTER TABLE groups ADD COLUMN invite_code_lookup TEXT;

CREATE UNIQUE INDEX groups_by_code ON groups(invite_code_lookup);
