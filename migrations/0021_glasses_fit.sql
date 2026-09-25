-- Where his glasses sit on his photograph (2026-09-24).
--
-- A photo's eyes are wherever the camera put them, and one fixed spot for
-- every pair sat on foreheads and chins. JSON {x, y, s}: an offset as a share
-- of the face's size, and a scale, each clamped by parseFit (protocol.ts)
-- before it reaches here. NULL is the default spot. Only over a photograph —
-- a face with none is drawn to fit — and cleared whenever he sets a new photo
-- or takes his off, because a fit belongs to one picture's eyes.
ALTER TABLE members ADD COLUMN glasses_fit TEXT;
