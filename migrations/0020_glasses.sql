-- Which pair of glasses a dad wears (2026-09-23).
--
-- The glasses are the app's symbol, and every dad who is coming wears a pair
-- on his face; this is which pair. NULL is the app's own shades, which is
-- what every dad wore before he could choose. Checked against a short
-- allowlist in the Worker (GLASSES, protocol.ts) before it reaches here.
ALTER TABLE members ADD COLUMN glasses TEXT;
