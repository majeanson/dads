import type { DadNight } from '../shared/dadNight';

export type Lang = 'en' | 'fr';

const EN = {
  // ------------------------------------------------------------ the door
  'join.lede': 'Somewhere to talk about it, and a table to sit at while you do.',
  'join.code': 'Code',
  'join.name': 'Your name',
  'join.come_in': 'Come in',
  'join.opening': 'Opening…',
  'join.bad_code': "That code doesn't open anything. Ask whoever sent you.",
  'join.missing_code': 'Enter the code.',
  'join.missing_name': 'Enter your name.',
  'join.name_too_long': "That's a long name — 32 characters or fewer.",
  'join.unknown': 'Something went wrong. Try again.',
  'join.too_many_one': 'Too many tries. Give it a minute.',
  'join.too_many_other': 'Too many tries. Give it {n} minutes.',
  'app.unreachable': 'Can’t reach the house right now.',

  // ------------------------------------------------------------ the room
  'room.here': '{n} here',
  'room.opening': 'Opening the door…',
  'room.reconnecting': 'Reconnecting…',
  'room.menu': 'Menu',
  'room.waiting': ' — something waiting',
  'room.empty': 'Nobody has said anything yet.',
  'room.typing': '{names} typing…',
  'room.messages': 'Messages',
  'room.unseen_one': '1 new ↓',
  'room.unseen_other': '{n} new ↓',
  'day.today': 'Today',
  'day.yesterday': 'Yesterday',

  'composer.say': 'Say something',
  'composer.caption': 'Add a caption, or just send it',
  'composer.send': 'Send',
  'composer.sending': 'Sending…',
  'composer.attach': 'Add a photo or a file',
  'composer.remove': 'Take it off',
  'composer.too_large': 'That one is too big — 25 MB is the limit.',
  'composer.upload_failed': 'Couldn’t send that. Try again.',
  'line.answered': 'answered',

  // ------------------------------------------------------------- the call
  'call.join': 'Join the call',
  'call.opening': 'Opening the mic…',
  'call.denied': 'The browser wouldn’t give up the microphone. Allow it and try again.',
  'call.failed': 'Couldn’t open the microphone.',
  'call.retry': 'Try again',
  'call.mute': 'Mute',
  'call.unmute': 'Unmute',
  'call.camera_on': 'Camera',
  'call.camera_off': 'Camera off',
  'call.leave': 'Leave',
  'call.alone': 'just you so far',
  'call.count': '{n} on the call',
  'call.you': 'You',
  'call.enlarge': 'Make this bigger',
  'call.shrink': 'Make this smaller again',
  'call.is_muted': 'microphone off',

  // ------------------------------------------------------------- the menu
  'menu.title': 'Menu',
  'menu.questions': 'Questions',
  'menu.week': 'The week',
  'menu.open_table': 'Open the table',
  'menu.close_table': 'Close the table',
  'menu.sign_out': 'Sign out',
  'menu.settings': 'Settings',
  'set.title': 'Settings',
  'set.rooms': 'In this room',
  'set.table': 'The table',
  'set.yours': 'On this device',
  'remind.off': 'Tell me when it opens',
  'remind.on': 'Tell me when it opens',
  'remind.needs_install': 'Add dads to your home screen to be told when the table opens.',
  'remind.blocked': 'Your browser is blocking notifications from this site.',
  'menu.language': 'Language',
  'menu.theme': 'Theme',
  'theme.system': 'Follow the phone',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'sheet.close': 'Close',

  // -------------------------------------------------------- who's here
  'here.title': 'Who’s here',
  'here.nobody': 'Nobody.',
  'here.comings': 'In and out',
  'here.nothing': 'Nothing yet.',
  'here.failed': 'That didn’t load.',
  'here.you': ' (you)',
  'here.came_in': '{name} came in',
  'here.left': '{name} left',

  // -------------------------------------------------------- the questions
  'q.title': 'Questions',
  'q.nobody_answered': 'Nobody yet.',
  'q.answers_one': '1 answer.',
  'q.answers_other': '{n} answers.',
  'q.you_answered': 'You answered.',
  'q.answer': 'Answer',
  'q.say_more': 'Say more',
  'q.your_answer': 'Your answer',
  'q.take_your_time': 'Take your time',
  'q.not_now': 'Not now',
  'q.asked_before': 'Before',
  'q.first_tomorrow': 'Nothing yet.',
  'q.add': 'Add a question',
  'q.add_label': 'A question for the group',
  'q.add_placeholder': 'Ask something',
  'q.add_button': 'Add',
  'q.by': 'by {name}',
  'q.yours': 'yours',
  'q.n_answers_one': '1 answer',
  'q.n_answers_other': '{n} answers',
  'q.loading': 'One moment…',
  'q.failed': 'That didn’t load.',
  'q.add_empty': 'Write the question first.',
  'q.add_too_long': 'That’s long for a question — 240 characters or fewer.',
  'q.add_already': 'That one is already in the list.',
  'q.add_unknown': 'Couldn’t add that. Try again.',

  // ---------------------------------------------------------- the week
  'b.title': 'The week',
  'b.loading': 'One moment…',
  'b.failed': 'That didn’t load.',
  'b.this_week': 'This week',
  'b.how_was': 'Your week',
  'b.note_label': 'One line about your week',
  'b.note_placeholder': 'One honest line',
  'b.commit_label': 'One thing to try',
  'b.commit_placeholder': 'Small and concrete',
  'b.save': 'Save',
  'b.waiting': 'Nothing yet: {names}',
  'b.trying': 'trying',
  'b.kept': 'kept',
  'b.missed': 'missed',
  'b.kept_count': '{kept}/{total} kept',
  'b.you_said': '{week} — you said you’d try: {body}',
  'b.how_did_it_go': 'How did it go?',
  'b.did_it': 'I did it',
  'b.didnt': 'I didn’t',
  'b.rating_1': 'rough',
  'b.rating_2': 'hard',
  'b.rating_3': 'alright',
  'b.rating_4': 'good',
  'b.rating_5': 'great',
  'b.week_of': 'week of {date}',

  // --------------------------------------------------------- the table
  't.title': 'The table',
  't.setting': 'Setting the table…',
  't.unreachable': 'Couldn’t reach the table.',
  't.own_tab': 'Own tab',
  't.close': 'Close the table',
  't.blocked': 'The table won’t open in here.',
  't.play': 'Play Jaffre',
  't.silent': 'The table isn’t answering in here.',
  't.silent_link': 'Open it in its own tab',
  't.silent_or': 'or',
  't.try_again': 'try again',

  // ------------------------------------------------------- dad night
  'n.title': 'Dad night',
  'n.set': 'Set dad night',
  'n.day': 'Day',
  'n.time': 'Time',
  'n.save': 'Save',
  'n.clear': 'Clear',
  'n.bad_time': 'Time needs to look like 21:00.',
  'n.save_failed': 'Couldn’t save that. Try again.',
  'n.item': 'Dad night {when} — {countdown}',
  'n.item_live': 'Dad night {when} — the table’s open',
  'n.item_plain': 'Dad night {when}',
  'n.soon': 'dad night {countdown}',
  'n.header': 'dad night {when}',
  'n.soon_live': 'dad night — the table’s open',
  'n.when': '{weekday}s at {time}',
  'n.countdown_now': 'any moment',
  'n.countdown_minutes_one': 'in a minute',
  'n.countdown_minutes_other': 'in {n} minutes',
  'n.countdown_hours_one': 'in an hour',
  'n.countdown_hours_other': 'in {n} hours',
  'n.countdown_days_one': 'tomorrow',
  'n.countdown_days_other': 'in {n} days',

  // ------------------------------------------- what the room says itself
  'sys.night_set': '{by} set dad night to {when}.',
  'sys.night_cleared': '{by} cleared dad night.',
  'sys.night_open': 'Dad night. The table’s open.',
  'sys.night_done_none': 'Dad night done. Nobody made it this week.',
  'sys.night_done': 'Dad night done — {dads}, {lines}.',
  'sys.night_dads_one': 'one dad turned up',
  'sys.night_dads_other': '{n} dads turned up',
  'sys.night_lines_one': 'one line',
  'sys.night_lines_other': '{n} lines',
  'sys.check_in': '{name} checked in — {rating}/5.',
  'sys.check_in_note': '{name} checked in — {rating}/5. {note}',
  'sys.commitment': '{name} is trying this week: {body}',
  'sys.commitment_short': 'and trying: {body}',
  'sys.kept': '{name} did it: {body}',
  'sys.kept_note': '{name} did it: {body} — {note}',
  'sys.missed': '{name} didn’t manage: {body}',
  'sys.missed_note': '{name} didn’t manage: {body} — {note}',
  'sys.table_seated': '{name} sat down at the table.',
  'sys.table_left': '{name} left the table.',
  'sys.table_started': 'A game started at the table.',
  'sys.table_over': 'Game over — {summary}',
} as const;

export type Key = keyof typeof EN;

const FR: Record<Key, string> = {
  // ------------------------------------------------------------ la porte
  'join.lede': 'Une place pour en parler, et une table pour jouer pendant ce temps-là.',
  'join.code': 'Code',
  'join.name': 'Ton nom',
  'join.come_in': 'Entre',
  'join.opening': 'J’ouvre…',
  'join.bad_code': 'Ce code-là n’ouvre rien. Demande à celui qui te l’a envoyé.',
  'join.missing_code': 'Entre le code.',
  'join.missing_name': 'Entre ton nom.',
  'join.name_too_long': 'C’est long comme nom — 32 caractères maximum.',
  'join.unknown': 'Quelque chose a mal tourné. Réessaie.',
  'join.too_many_one': 'Trop d’essais. Attends une minute.',
  'join.too_many_other': 'Trop d’essais. Attends {n} minutes.',
  'app.unreachable': 'Impossible de rejoindre la maison pour l’instant.',

  // ------------------------------------------------------------ la salle
  'room.here': '{n} ici',
  'room.opening': 'J’ouvre la porte…',
  'room.reconnecting': 'Je me reconnecte…',
  'room.menu': 'Menu',
  'room.waiting': ' — il y a quelque chose qui t’attend',
  'room.empty': 'Personne n’a rien dit encore.',
  'room.typing': '{names} écrit…',
  'room.messages': 'Messages',
  'room.unseen_one': '1 nouveau ↓',
  'room.unseen_other': '{n} nouveaux ↓',
  'day.today': 'Aujourd’hui',
  'day.yesterday': 'Hier',

  'composer.say': 'Dis quelque chose',
  'composer.caption': 'Mets un mot avec, ou envoie-le comme ça',
  'composer.send': 'Envoie',
  'composer.sending': 'J’envoie…',
  'composer.attach': 'Ajoute une photo ou un fichier',
  'composer.remove': 'Enlève-le',
  'composer.too_large': 'Celui-là est trop gros — 25 Mo maximum.',
  'composer.upload_failed': 'Ça n’a pas passé. Réessaie.',
  'line.answered': 'a répondu',

  // ------------------------------------------------------------ l'appel
  'call.join': 'Embarque dans l’appel',
  'call.opening': 'J’ouvre le micro…',
  'call.denied': 'Le navigateur refuse de donner le micro. Autorise-le et réessaie.',
  'call.failed': 'Impossible d’ouvrir le micro.',
  'call.retry': 'Réessaie',
  'call.mute': 'Coupe le micro',
  'call.unmute': 'Rouvre le micro',
  'call.camera_on': 'Caméra',
  'call.camera_off': 'Ferme la caméra',
  'call.leave': 'Raccroche',
  'call.alone': 'juste toi pour l’instant',
  'call.count': '{n} dans l’appel',
  'call.you': 'Toi',
  'call.enlarge': 'Agrandis',
  'call.shrink': 'Réduis',
  'call.is_muted': 'micro fermé',

  // ------------------------------------------------------------- le menu
  'menu.title': 'Menu',
  'menu.questions': 'Les questions',
  'menu.week': 'La semaine',
  'menu.open_table': 'Ouvre la table',
  'menu.close_table': 'Ferme la table',
  'menu.sign_out': 'Déconnexion',
  'menu.settings': 'Réglages',
  'set.title': 'Réglages',
  'set.rooms': 'Dans cette salle',
  'set.table': 'La table',
  'set.yours': 'Sur cet appareil',
  'remind.off': 'Avertis-moi quand ça ouvre',
  'remind.on': 'Avertis-moi quand ça ouvre',
  'remind.needs_install':
    'Ajoute dads à ton écran d’accueil pour être averti quand la table ouvre.',
  'remind.blocked': 'Ton navigateur bloque les notifications de ce site.',
  'menu.language': 'Langue',
  'menu.theme': 'Thème',
  'theme.system': 'Comme le téléphone',
  'theme.light': 'Clair',
  'theme.dark': 'Sombre',
  'sheet.close': 'Ferme',

  // ----------------------------------------------------------- qui est là
  'here.title': 'Qui est là',
  'here.nobody': 'Personne.',
  'here.comings': 'Entrées et sorties',
  'here.nothing': 'Rien encore.',
  'here.failed': 'Ça n’a pas chargé.',
  'here.you': ' (toi)',
  'here.came_in': '{name} est arrivé',
  'here.left': '{name} est parti',

  // -------------------------------------------------------- les questions
  'q.title': 'Les questions',
  'q.nobody_answered': 'Personne encore.',
  'q.answers_one': '1 réponse.',
  'q.answers_other': '{n} réponses.',
  'q.you_answered': 'Tu as répondu.',
  'q.answer': 'Réponds',
  'q.say_more': 'Ajoute quelque chose',
  'q.your_answer': 'Ta réponse',
  'q.take_your_time': 'Prends ton temps',
  'q.not_now': 'Pas maintenant',
  'q.asked_before': 'Avant',
  'q.first_tomorrow': 'Rien encore.',
  'q.add': 'Ajoute une question',
  'q.add_label': 'Une question pour le groupe',
  'q.add_placeholder': 'Demande quelque chose',
  'q.add_button': 'Ajoute',
  'q.by': 'de {name}',
  'q.yours': 'la tienne',
  'q.n_answers_one': '1 réponse',
  'q.n_answers_other': '{n} réponses',
  'q.loading': 'Un instant…',
  'q.failed': 'Ça n’a pas chargé.',
  'q.add_empty': 'Écris la question d’abord.',
  'q.add_too_long': 'C’est long pour une question — 240 caractères maximum.',
  'q.add_already': 'Celle-là est déjà dans la liste.',
  'q.add_unknown': 'Ça n’a pas marché. Réessaie.',

  // ------------------------------------------------------------ la semaine
  'b.title': 'La semaine',
  'b.loading': 'Un instant…',
  'b.failed': 'Ça n’a pas chargé.',
  'b.this_week': 'Cette semaine',
  'b.how_was': 'Ta semaine',
  'b.note_label': 'Une ligne sur ta semaine',
  'b.note_placeholder': 'Une ligne honnête',
  'b.commit_label': 'Une affaire à essayer',
  'b.commit_placeholder': 'Petit et concret',
  'b.save': 'Enregistre',
  'b.waiting': 'Rien encore : {names}',
  'b.trying': 'essaie',
  'b.kept': 'fait',
  'b.missed': 'manqué',
  'b.kept_count': '{kept}/{total} de faits',
  'b.you_said': '{week} — tu disais que t’essaierais : {body}',
  'b.how_did_it_go': 'Ça a donné quoi?',
  'b.did_it': 'Je l’ai fait',
  'b.didnt': 'Pas fait',
  'b.rating_1': 'poche',
  'b.rating_2': 'dure',
  'b.rating_3': 'correcte',
  'b.rating_4': 'bonne',
  'b.rating_5': 'excellente',
  'b.week_of': 'semaine du {date}',

  // -------------------------------------------------------------- la table
  't.title': 'La table',
  't.setting': 'Je prépare la table…',
  't.unreachable': 'La table ne répond pas.',
  't.own_tab': 'Autre onglet',
  't.close': 'Ferme la table',
  't.blocked': 'La table refuse de s’ouvrir ici.',
  't.play': 'Joue à Jaffré',
  't.silent': 'La table ne dit rien ici.',
  't.silent_link': 'Ouvre-la dans un autre onglet',
  't.silent_or': 'ou',
  't.try_again': 'réessaie',

  // -------------------------------------------------------- soirée de gars
  'n.title': 'Soirée de gars',
  'n.set': 'Mets une soirée de gars',
  'n.day': 'Jour',
  'n.time': 'Heure',
  'n.save': 'Enregistre',
  'n.clear': 'Efface',
  'n.bad_time': 'L’heure doit ressembler à 21:00.',
  'n.save_failed': 'Ça n’a pas enregistré. Réessaie.',
  'n.item': 'Soirée de gars {when} — {countdown}',
  'n.item_live': 'Soirée de gars {when} — la table est ouverte',
  'n.item_plain': 'Soirée de gars {when}',
  'n.soon': 'soirée de gars {countdown}',
  'n.header': 'soirée de gars {when}',
  'n.soon_live': 'soirée de gars — la table est ouverte',
  'n.when': 'les {weekday}s à {time}',
  'n.countdown_now': 'd’une minute à l’autre',
  'n.countdown_minutes_one': 'dans une minute',
  'n.countdown_minutes_other': 'dans {n} minutes',
  'n.countdown_hours_one': 'dans une heure',
  'n.countdown_hours_other': 'dans {n} heures',
  'n.countdown_days_one': 'demain',
  'n.countdown_days_other': 'dans {n} jours',

  // ------------------------------------------------- ce que la salle dit
  'sys.night_set': '{by} a mis la soirée de gars {when}.',
  'sys.night_cleared': '{by} a effacé la soirée de gars.',
  'sys.night_open': 'Soirée de gars. La table est ouverte.',
  'sys.night_done_none': 'Soirée finie. Personne n’est venu cette semaine.',
  'sys.night_done': 'Soirée finie — {dads}, {lines}.',
  'sys.night_dads_one': 'un gars est venu',
  'sys.night_dads_other': '{n} gars sont venus',
  'sys.night_lines_one': 'un message',
  'sys.night_lines_other': '{n} messages',
  'sys.check_in': '{name} a fait son point — {rating}/5.',
  'sys.check_in_note': '{name} a fait son point — {rating}/5. {note}',
  'sys.commitment': '{name} essaie ça cette semaine : {body}',
  'sys.commitment_short': 'et essaie : {body}',
  'sys.kept': '{name} l’a fait : {body}',
  'sys.kept_note': '{name} l’a fait : {body} — {note}',
  'sys.missed': '{name} n’y est pas arrivé : {body}',
  'sys.missed_note': '{name} n’y est pas arrivé : {body} — {note}',
  'sys.table_seated': '{name} s’est assis à la table.',
  'sys.table_left': '{name} a quitté la table.',
  'sys.table_started': 'Une partie vient de commencer.',
  'sys.table_over': 'Partie finie — {summary}',
};

const WEEKDAYS: Record<Lang, readonly string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  fr: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
};

function fill(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

export type T = (key: Key, params?: Record<string, string | number>) => string;

export function translator(lang: Lang): T {
  const table = lang === 'fr' ? FR : EN;
  return (key, params) => fill(table[key], params);
}

/**
 * One and other, the only two the two languages need. French keeps the
 * singular for zero as well, which English does not.
 */
export function plural(lang: Lang, n: number): 'one' | 'other' {
  return lang === 'fr' ? (n < 2 ? 'one' : 'other') : n === 1 ? 'one' : 'other';
}

/** "Thursdays at 21:00" / "les jeudis à 21:00". */
export function nightWhen(lang: Lang, night: DadNight): string {
  return translator(lang)('n.when', {
    weekday: WEEKDAYS[lang][night.weekday] ?? '',
    time: night.time,
  });
}

/** The day names the night editor offers, in the reader's language. */
export function weekdayNames(lang: Lang): readonly string[] {
  return WEEKDAYS[lang];
}

/**
 * What the test needs to hold the two sides level: the keys, and the tables
 * themselves. Nothing in the app reads these — `translator` is the door.
 */
export const TABLES: Record<Lang, Record<Key, string>> = { en: EN, fr: FR };
export const EN_KEYS = Object.keys(EN).sort() as Key[];
export const FR_KEYS = Object.keys(FR).sort() as Key[];
