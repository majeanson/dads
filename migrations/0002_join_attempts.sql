-- Failed-join throttling.
--
-- The invite code is the only thing standing between the group and a stranger,
-- and it is a passphrase five friends can remember — which is to say, guessable
-- given enough tries. PBKDF2 makes each guess expensive; this table makes the
-- number of guesses finite.
--
-- Only failures are recorded, and a success clears the bucket, so a dad who
-- fat-fingers his code twice and then gets it right is never punished.

CREATE TABLE join_attempts (
  -- HMAC of the client IP. Never the address itself: this is a log of who
  -- failed to get in, and it should not also be a log of where they were.
  bucket       TEXT PRIMARY KEY,
  failures     INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
