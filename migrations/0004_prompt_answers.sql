-- Ties an answer to the question it answers.
--
-- Counting answers by timestamp range would almost work, and would quietly go
-- wrong at midnight and across a timezone change. A direct reference is the
-- only way "3 dads answered this one" stays true.
ALTER TABLE messages ADD COLUMN prompt_id TEXT REFERENCES prompts(id) ON DELETE SET NULL;

CREATE INDEX messages_by_prompt ON messages(group_id, prompt_id);
