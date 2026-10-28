/** One dad as the rest of the room can read him (`GET /api/profile`). */
export interface Profile {
  memberId: string;
  name: string;
  joinedAt: number;
  /** His answer for the evening coming up, or null: none, or no night. */
  night: 'in' | 'maybe' | 'out' | null;
  /** Upcoming evenings he put up or answered. */
  events: {
    id: string;
    title: string;
    place: string;
    day: string;
    time: string;
    hosting: boolean;
    answer: 'in' | 'maybe' | 'out' | null;
  }[];
  /** What he said to the day's question, newest first. Null: questions are off. */
  answers:
    | {
        id: string;
        at: number;
        question: string;
        questionFr: string | null;
        body: string;
      }[]
    | null;
  /** This week on the board, the way the group reads it. Null: the week is off. */
  week: {
    checkIn: { rating: number; note: string } | null;
    commitment: { body: string; outcome: string } | null;
  } | null;
}
