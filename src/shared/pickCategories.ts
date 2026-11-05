/**
 * The three things worth recommending. Alone in a file so the wire
 * (`protocol.ts`, in the entry bundle) can name them without pulling in the
 * classifier and the unfurler behind `picks.ts`.
 */
export const PICK_CATEGORIES = ['watch', 'listen', 'read'] as const;
export type PickCategory = (typeof PICK_CATEGORIES)[number];
