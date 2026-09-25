import type { Answer } from './api';
import { useT } from './i18n';
import { Button } from './ui/Button';
import { cn } from './ui/cn';

/**
 * One question, three answers: in, maybe, can't.
 *
 * Three segments of one control, and a filled thumb that slides under the
 * one he chose — so what he said is on the screen without a word explaining
 * it, and changing his mind is something he can watch happen. All three stay
 * on the screen from the start: an RSVP is announced by name, so a man who
 * cannot come must not have to say he can and then take it back, and three
 * answers cannot be a toggle.
 *
 * Shared by home's card and the night sheet. The sheet used to have three
 * separate buttons that wrapped two-and-one on a 390px phone, in both
 * languages, under a card that showed the same question as one row.
 *
 * No icons: three controls across a 390px card in French ("Je suis là ·
 * Peut-être · Je peux pas") has room for the words or for the glyphs, and
 * the words are the ones that say anything.
 */
export function Answers({
  mine,
  busy,
  onAnswer,
  ids,
}: {
  mine: Answer | null;
  busy: boolean;
  onAnswer: (answer: Answer) => void;
  /** Test ids for the three segments, so each screen keeps its own names. */
  ids: Record<Answer, string>;
}) {
  const { t } = useT();
  return (
    <div
      className="home-answers"
      role="group"
      aria-label={t('n.title')}
      data-chosen={mine ?? 'none'}
    >
      {/* The one filled segment, sliding to whichever he chose. It is a
          picture of the answer, not the answer: each segment still carries
          aria-pressed, and the words stay where they are. */}
      <span className="home-answers-thumb" aria-hidden="true" />
      {(['in', 'maybe', 'out'] as const).map((answer) => (
        <Segment
          key={answer}
          answer={answer}
          mine={mine}
          busy={busy}
          onAnswer={onAnswer}
          testId={ids[answer]}
        />
      ))}
    </div>
  );
}

/** One of the three. Which one is filled is `aria-pressed`, and the words
 * are the label: a sighted man can see which one is filled, and a label
 * explaining a button is a button that needed explaining. */
function Segment({
  answer,
  mine,
  busy,
  onAnswer,
  testId,
}: {
  answer: Answer;
  mine: Answer | null;
  busy: boolean;
  onAnswer: (answer: Answer) => void;
  testId: string;
}) {
  const { t } = useT();
  const chosen = mine === answer;
  const label = answer === 'in' ? t('n.im_in') : answer === 'maybe' ? t('n.maybe') : t('n.cant');

  return (
    <Button
      look="quiet"
      size="lg"
      className={cn(
        'home-answer relative h-[clamp(2.75rem,6dvh,3.25rem)] px-1 text-base font-medium',
        'rounded-[calc(var(--radius-control)-0.25rem)] transition-colors duration-200',
        chosen
          ? answer === 'out'
            ? 'text-paper hover:text-paper'
            : 'text-on-accent hover:text-on-accent'
          : 'text-ink',
      )}
      disabled={busy}
      aria-pressed={chosen}
      onClick={() => void onAnswer(answer)}
      data-testid={testId}
      data-mine={chosen ? 'yes' : 'no'}
    >
      {label}
    </Button>
  );
}
