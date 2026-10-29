import { ArrowLeft, Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fetchProfile, type Profile as ProfileData } from './api';
import { Face } from './Face';
import { promptText, useT } from './i18n';
import { Button } from './ui/Button';

/**
 * One dad, as the room can read him: his face, when he arrived, his answer
 * for the next night, the evenings he is in on, what he said to the questions
 * and where his week is.
 *
 * Nothing here is private to him. It is the same things the group already
 * sees, each on its own screen, put where you can ask "what is Sam like?"
 * rather than "where did Sam say that?".
 */
export function Profile({
  memberId,
  you,
  onBack,
}: {
  memberId: string;
  you: boolean;
  onBack: () => void;
}) {
  const { t, lang } = useT();
  const locale = lang === 'fr' ? 'fr-CA' : 'en-CA';
  const [data, setData] = useState<ProfileData | null | 'loading'>('loading');

  useEffect(() => {
    let cancelled = false;
    setData('loading');
    fetchProfile(memberId)
      .then((p) => !cancelled && setData(p))
      .catch(() => !cancelled && setData(null));
    return () => {
      cancelled = true;
    };
  }, [memberId]);

  const day = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  const answerWord = (a: 'in' | 'maybe' | 'out' | null) =>
    a === null ? t('pr.no_answer') : t(`pr.${a}`);

  return (
    <div className="grid gap-5" data-testid="profile">
      <Button look="quiet" className="justify-self-start px-0" onClick={onBack}>
        <ArrowLeft size={18} aria-hidden="true" />
        {t('pr.back')}
      </Button>

      {data === 'loading' ? (
        <p className="m-0 text-muted">…</p>
      ) : data === null ? (
        <p className="m-0 text-muted">{t('here.failed')}</p>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <Face memberId={data.memberId} size={72} />
            <div className="min-w-0">
              <h2 className="display m-0 truncate text-2xl text-ink" data-testid="profile-name">
                {data.name}
                {you ? t('here.you') : ''}
              </h2>
              <p className="m-0 text-base text-muted">
                {t('pr.joined', {
                  date: new Date(data.joinedAt).toLocaleDateString(locale, {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  }),
                })}
              </p>
            </div>
          </div>

          <section className="grid gap-1.5" data-testid="profile-dates">
            <h3 className="m-0 text-[1.0625rem] font-semibold text-muted">{t('pr.dates')}</h3>
            <p className="m-0 text-[1.0625rem]">
              {t('n.title')} — {answerWord(data.night)}
            </p>
            {data.events.length === 0 ? (
              <p className="m-0 text-muted">{t('pr.no_dates')}</p>
            ) : (
              <ul className="m-0 grid list-none gap-1.5 p-0">
                {data.events.map((e) => (
                  <li key={e.id} className="text-[1.0625rem]">
                    <span className="font-semibold">{e.title}</span>
                    <span className="text-muted">
                      {' '}
                      · {day(e.day)} {e.time}
                      {e.place ? ` · ${e.place}` : ''} ·{' '}
                      {e.hosting ? t('pr.hosting') : answerWord(e.answer)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data.week === null ? null : (
            <section className="grid gap-1.5" data-testid="profile-week">
              <h3 className="m-0 text-[1.0625rem] font-semibold text-muted">{t('b.this_week')}</h3>
              {data.week.checkIn === null && data.week.commitment === null ? (
                <p className="m-0 text-muted">{t('b.waiting_short')}</p>
              ) : (
                <>
                  {data.week.checkIn === null ? null : (
                    <p className="m-0 text-[1.0625rem]">
                      {t(`b.rating_${data.week.checkIn.rating}` as 'b.rating_1')}
                      {data.week.checkIn.note ? ` — ${data.week.checkIn.note}` : ''}
                    </p>
                  )}
                  {data.week.commitment === null ? null : (
                    <p className="m-0 text-[1.0625rem]">
                      {data.week.commitment.body}{' '}
                      <span className="text-muted">
                        ·{' '}
                        {data.week.commitment.outcome === 'done'
                          ? t('b.kept')
                          : data.week.commitment.outcome === 'missed'
                            ? t('b.missed')
                            : t('b.trying')}
                      </span>
                    </p>
                  )}
                </>
              )}
            </section>
          )}

          {data.answers === null ? null : (
            <section className="grid gap-2" data-testid="profile-answers">
              <h3 className="m-0 text-[1.0625rem] font-semibold text-muted">{t('pr.answers')}</h3>
              {data.answers.length === 0 ? (
                <p className="m-0 text-muted">{t('pr.no_answers')}</p>
              ) : (
                <ul className="m-0 grid list-none gap-3 p-0">
                  {data.answers.map((a) => (
                    <li key={a.id} className="grid gap-0.5 text-[1.0625rem]">
                      <span className="text-sm text-muted">
                        {promptText(lang, { body: a.question, bodyFr: a.questionFr })}
                      </span>
                      <span>{a.body}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {you ? (
            <section className="grid gap-1" data-testid="profile-export">
              <a
                href="/api/export"
                download
                className="inline-flex min-h-11 items-center gap-2 text-[1.0625rem] text-accent underline"
              >
                <Download size={18} aria-hidden="true" />
                {t('pr.export')}
              </a>
              <p className="m-0 text-sm text-muted">{t('pr.export_hint')}</p>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
