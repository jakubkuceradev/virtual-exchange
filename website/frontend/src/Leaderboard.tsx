import { useState } from 'react';
import { useDemo } from './DemoContext';
import type { Period } from './fixtures.ts';
import { periods } from './fixtures.ts';
import { Nearby, PeriodControls, RankingRows } from './Standings';
import { cx, signed } from './styles';

export function Leaderboard({ active }: { active: boolean }) {
  const { empty } = useDemo();
  const [selected, setSelected] = useState<Period>('continuous');
  const period = periods[selected];
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
        <PeriodControls value={selected} onChange={setSelected} />
      </div>
      <div className={cx('leader-summary')}>
        <div>
          <span className={cx('label')}>{'YOUR RANK'}</span>
          <strong id="leader-rank">
            {empty ? (
              '—'
            ) : (
              <>
                #{period.rank} <small>/ 142</small>
              </>
            )}
          </strong>
        </div>
        <div>
          <span className={cx('label')}>{'YOUR RETURN'}</span>
          <strong id="leader-return" className={cx('positive')}>
            {empty ? '—' : signed(period.profit)}
          </strong>
        </div>
      </div>
      <div className={cx('leader-grid')}>
        <article className={cx('panel leaderboard-panel')}>
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
                <RankingRows period={period} />
              </tbody>
            </table>
          </div>
          <div className={cx('panel-foot')}>
            <span>{'Leaders + your neighborhood'}</span>
            <span>{'142 participants'}</span>
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
              <Nearby period={period} />
            </div>
          </article>
        </aside>
      </div>
      <p id="period-feedback" className={cx('sr-only')} role="status">
        {empty
          ? 'Awaiting the first ranking snapshot.'
          : `${period.label} standings shown. Your sample rank is ${period.rank}.`}
      </p>
    </section>
  );
}
