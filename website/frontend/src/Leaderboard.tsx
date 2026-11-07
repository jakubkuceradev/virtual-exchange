/**
 * Leaderboard: real selection UI over sample observations.
 * @mock-backend All periods select fixed ranks/returns/participants; live mode has no rankings
 *   and shows an unavailable state.
 * @mock-frontend Participant count and summary standings are fixed visual placeholders.
 * @implemented-ui Period selection, selection persistence, summary/table/nearby layout.
 * Replace period datasets with website-backend results; retain selection/rendering.
 */
import { useState } from 'react';
import type { Period } from './fixtures.ts';
import { Nearby, PeriodControls, RankingRows } from './Standings';
import { cx, signed } from './styles';
import { useTrading } from './trading/context.tsx';

/** @mock-backend Selected period reads fixtures, not a service. @implemented-ui Period selection is functional. */
export function Leaderboard({ active }: { active: boolean }) {
  const { samples, identity } = useTrading();
  const [selected, setSelected] = useState<Period>('continuous');
  const period = samples?.periods[selected] ?? null;
  const empty = !!samples?.empty;
  const participantCount = samples?.participantCount;
  const rankings = { period, empty, you: identity?.name ?? '' };
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
          disabled={!samples}
        />
      </div>
      <div className={cx('leader-summary')}>
        <div>
          <span className={cx('label')}>{'YOUR RANK'}</span>
          <strong id="leader-rank">
            {!period || empty ? (
              '—'
            ) : (
              <>
                #{period.rank} <small>/ {participantCount}</small>
              </>
            )}
          </strong>
        </div>
        <div>
          <span className={cx('label')}>{'YOUR RETURN'}</span>
          <strong id="leader-return" className={cx('positive')}>
            {!period || empty ? '—' : signed(period.profit)}
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
        {!samples
          ? 'Rankings are not calculated yet.'
          : !period || empty
            ? 'Awaiting the first ranking snapshot.'
            : `${period.label} standings shown. Your sample rank is ${period.rank}.`}
      </p>
    </section>
  );
}
