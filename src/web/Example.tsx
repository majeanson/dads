import { Eye } from 'lucide-react';
import { Face } from './Face';
import { useT, type Key } from './i18n';
import { Sheet } from './ui/Sheet';

/**
 * What a room looks like, for somebody who has only seen the door.
 *
 * The door is a form, and the only way to learn what is behind it used to be
 * opening a room. This is an example, said as one: invented dads, a night
 * with answers on it and four lines of talk, all of it text in the page.
 * There is no demo room — nothing is fetched, nobody can walk into one, and
 * no real room's name or line is ever shown to a stranger.
 *
 * Loaded when first wanted. The faces are the app's own (`Face` draws a
 * colour, a pair of glasses and a smile for an id it has never heard of), so
 * what a stranger sees is what he will be.
 */
const DADS = ['example-marc', 'example-sam', 'example-theo', 'example-luc'] as const;

const LINES: { dad: number; text: Key }[] = [
  { dad: 1, text: 'ex.line_1' },
  { dad: 0, text: 'ex.line_2' },
  { dad: 2, text: 'ex.line_3' },
  { dad: 3, text: 'ex.line_4' },
];

/** Proper names, the same in both languages, so not in the dictionary. */
const NAMES = ['Marc', 'Sam', 'Théo', 'Luc'] as const;

export function Example({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  return (
    <Sheet title={t('ex.title')} pose={Eye} onClose={onClose}>
      <div className="grid gap-5" data-testid="example">
        <p className="m-0 text-base text-muted">{t('ex.note')}</p>

        <section
          className="grid gap-2 rounded-[var(--radius-card)] bg-panel p-4"
          aria-label={t('ex.night')}
        >
          <p className="display m-0 text-2xl">{t('ex.night')}</p>
          <p className="m-0 text-[1.0625rem]">{t('ex.answers')}</p>
          <ul className="m-0 flex list-none gap-2 p-0" aria-hidden="true">
            {DADS.map((id) => (
              <li key={id}>
                <Face memberId={id} size={36} />
              </li>
            ))}
          </ul>
        </section>

        <ul className="m-0 grid list-none gap-3 p-0">
          {LINES.map(({ dad, text }) => (
            <li key={text} className="grid grid-cols-[2rem_1fr] items-start gap-3">
              <Face memberId={DADS[dad]!} size={32} />
              <p className="m-0 text-[1.0625rem]">
                <span className="font-semibold">{NAMES[dad]}</span>
                <span className="block">{t(text)}</span>
              </p>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}
