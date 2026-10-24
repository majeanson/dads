# dads.marcportal.com — stranger review (2026-10-23)

Visited cold, then (with Marc's OK) created a throwaway room **« test-claude »** (word
`quokka-ember-7319`, member « Claude (test) ») and posted one message « Test message (stranger
review) ». **Delete it when convenient** — no delete-room control was visible in the UI.
Phone (375 px) and desktop.

## First impression

The tagline is lovely (« A few dads, one night together, and a chat for the days in
between. »). But a stranger lands on a login form — Code / Your name / Come in — with nothing
to look at and no idea what's behind it. Inside, a new room is mostly empty space with one
card and a truncated button.

## Friction, most important first

1. **« Go and talk » is truncated to « Go and t… » on a 375 px phone** — the main chat button
   on the room home. On desktop the round avatar on that button is clipped at the top edge.
   Visible bug, first screen after creating a room.
2. **Nothing for a stranger before the gate.** Add 3 lines or one screenshot under the tagline:
   pick a night together, say if you're coming, chat in between. Right now the only way to
   learn is to make a room.
3. **« Code » on the front door vs « the word » everywhere else** (« The word to get in »,
   « I have a word already »). Use one name — « the word » fits the voice.
4. **Inviting is buried.** After creating a room with 1 person, the room home shows no
   « invite / share the word » action; « Invite a dad » lives in Settings → In this room. A
   room of one should lead with « Send the word to the others » (share sheet + copy).
5. **A four-letter word is the only key.** « Anyone with this word can come in. Four letters or
   more. » If words are global, short ones are guessable and could collide with someone else's
   room. Suggest generating a word by default (« ember-quokka ») and showing strength, or make
   rooms need word + room name.
6. **« What this is » is two sentences.** It's the only help; it doesn't say how to invite,
   what « The week », « Questions » or « Open the table » are. « Open the table » in the menu
   is especially opaque to a stranger.
7. **Day picker cycles yes → maybe → no on repeated taps** with no legend showing the three
   states, and today isn't marked differently from other selectable days. A stranger taps once
   and doesn't know what they said.
8. **Menu shows a « something waiting » dot on a brand-new room** (« a question for you »,
   « your week to fill in »). Good nudge, but on an empty room it feels like noise; hold it
   until someone else is in.
9. **The logo changes between screens** (smiling face on the front door, sunglasses face on
   « Your own room » and as my avatar). Cute if intended as « your glasses »; confusing as the
   brand mark.
10. **Desktop is a phone layout floating top-left** with the rest of the window empty.

## Deeper pass: Questions, The week, The table

1. **« Open the table » is a card game, and nothing says so.** It opens an embedded,
   pixel-font game lobby (« ROOM TEST-CLAUDE-461B2E · Share this code with your table · Seat 1–4 ·
   SIT HERE / ADD BOT ») inside the chat. In the menu it reads like « open the dinner table ».
   « Play cards (4 seats) » or a one-line subtitle would fix it. The lobby's look (purple, pixel
   type) is a different app inside this one, and its room name wraps over four lines on a
   phone.
2. **A third « code »**: the front door says Code, the room uses « the word », and the table
   asks to « Share this code with your table ». Inside a room, the table could just invite the
   room.
3. **The first Question assumes a good father**: « What did your father get right that you want
   to pass on? ». For a dad whose father was absent or harmful, the first thing the app asks is
   a hard one, with no « another question » button. Add « Skip / another one », and lead with a
   lighter question in a new room.
4. **The week is a nice ritual (1–5, one line, one thing to try) but « Everyone, this week ·
   Nothing yet: Claude (test) (you) »** lists _me_ under « nothing yet » while I'm looking at the
   empty form — it reads like a shaming roll call. Show it only after the first person posts.
5. **The scale labels are doubled**: « 1 — rough … 5 — great » on the buttons, then « rough »
   and « great » again under the ends.

Good: Questions + The week + the dad-night picker are a thoughtful trio for keeping a group
alive between nights; each can be turned off per room in Settings; « What was asked before »
keeps an archive.

## Ideas

- **A demo room** (« Peek inside ») with a few fake dads, a picked night and a short chat, the
  way Babillard's 24-hour trial works.
- **Lead the empty room with a 3-step checklist**: send the word · pick your days · say hi.
- **Calendar export for the chosen night** (.ics download, no network beyond the app) so dad
  night lands in phone calendars.
- **FR by default for a Québec audience**, or follow the phone language — the site opened EN.

## Worked well

- Zero-friction entry: no account, no email, name + word and you're in.
- Chat composer is clean (photo, voice, text) with a friendly empty state.
- Settings are well grouped (You / In this room / On this device) with per-room feature
  toggles.
