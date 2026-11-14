/**
 * Leaderboard over the source's competition view.
 * @implemented-ui Period selection, selection persistence, summary/table/nearby
 *   layout. Live standings come from the website backend and are public; the
 *   caller's rank and return appear when signed in. Unavailable or stale data
 *   shows the unavailable state, never fixtures.
 */
import { useState } from 'react';
import type { Period } from './fixtures.ts';
import {
  Nearby,
  PeriodControls,
  periodLabels,
  RankingRows,
  unrankedMessage,
} from './Standings';
import { cx, signed } from './styles';
import { useTrading } from './trading/context.tsx';

/** @implemented-ui Period selection over source standings. */
export function Leaderboard({ active }: { active: boolean }) {
  const { competition, identity } = useTrading();
  const [selected, setSelected] = useState<Period>('continuous');
  const ready = competition.status === 'ready';
  const period = ready ? competition.periods[selected] : null;
  const empty = competition.status === 'empty';
  const participantCount = period?.participantCount;
  const you = period?.you ?? null;
  const rankings = {
    period: empty ? null : period,
    empty,
    you: identity?.name ?? '',
  };
  const placeholder = !period || empty;
  return (
    <section
      data-view="leaderboard"
      aria-labelledby="leaderboard-title"
      hidden={!active}
    >
      <h1 id="leaderboard-title" className={cx('sr-only')} tabIndex={-1}>
        {'Leaderboard'}
      </h1>
      <div className={cx('leader-toolbar')}>
        <PeriodControls
          value={selected}
          onChange={setSelected}
          disabled={!ready && !empty}
        />
      </div>
      <div className={cx('leader-summary')}>
        <div>
          <span className={cx('label')}>{'YOUR RANK'}</span>
          <strong id="leader-rank">
            {placeholder || you?.rank == null ? (
              '—'
            ) : (
              <>
                #{you.rank} <small>/ {participantCount}</small>
              </>
            )}
          </strong>
        </div>
        <div>
          <span className={cx('label')}>{'YOUR RETURN'}</span>
          <strong
            id="leader-return"
            className={cx(
              (you?.returnPercent ?? 0) >= 0 ? 'positive' : 'negative',
            )}
          >
            {placeholder || you?.returnPercent == null
              ? '—'
              : signed(you.returnPercent)}
          </strong>
        </div>
      </div>
      <div className={cx('leader-grid')}>
        <article className={cx('panel')}>
          <div className={cx('panel-heading')}>
            <div>
              <p className={cx('eyebrow')}>{'THE FIELD'}</p>
              <h2 id="ranking-title">{'Leaderboard'}</h2>
            </div>
          </div>
          <div className={cx('table-scroll')}>
            <table className={cx('data-table ranking-table')}>
              <caption className={cx('sr-only')}>
                {'Participant ranks and summary returns only'}
              </caption>
              <thead>
                <tr>
                  <th>{'Rank'}</th>
                  <th>{'Participant'}</th>
                  <th>{'Return'}</th>
                </tr>
              </thead>
              <tbody>
                <RankingRows {...rankings} />
              </tbody>
            </table>
          </div>
          <div className={cx('panel-foot')}>
            <span>{'Leaders + your neighborhood'}</span>
            <span>
              {participantCount == null
                ? 'Rankings unavailable'
                : `${participantCount} participants`}
            </span>
          </div>
        </article>
        <aside>
          <article className={cx('panel nearby-panel')}>
            <div className={cx('panel-heading')}>
              <div>
                <p className={cx('eyebrow')}>{'WITHIN REACH'}</p>
                <h2>{'Around your position'}</h2>
              </div>
            </div>
            <div className={cx('nearby-list')}>
              <Nearby {...rankings} />
            </div>
          </article>
        </aside>
      </div>
      <p id="period-feedback" className={cx('sr-only')} role="status">
        {competition.status === 'loading' ||
        competition.status === 'unavailable'
          ? 'Rankings are not calculated yet.'
          : placeholder
            ? 'Awaiting the first ranking snapshot.'
            : `${periodLabels[selected]} standings shown. ${
                you == null
                  ? 'Connect your account to see your rank.'
                  : you.rank == null
                    ? unrankedMessage(you.reason)
                    : `Your rank is ${you.rank}.`
              }`}
      </p>
    </section>
  );
}
