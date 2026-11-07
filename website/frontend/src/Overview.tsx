import { PerformanceChart } from './Charts';
import { useDemo } from './DemoContext';
import { periods, snapshot } from './fixtures.ts';
import { Nearby } from './Standings';
import { cx, money, number, signed } from './styles';

export function Overview({ active }: { active: boolean }) {
  const { state, available, empty } = useDemo();
  const total = state.cash + state.holdings * snapshot.price;
  const profit = total - snapshot.baseline;
  return (
    <section
      data-view="overview"
      aria-labelledby="overview-title"
      hidden={!active}
    >
      <h1 id="overview-title" className={cx('sr-only')} tabIndex={-1}>
        {'Overview'}
      </h1>
      <div className={cx('metric-grid')}>
        <article className={cx('metric')}>
          <span className={cx('label')}>{'TOTAL ACCOUNT VALUE'}</span>
          <div className={cx('metric-number')} data-value="total">
            {money(total)} <small>EUR</small>
          </div>
          <span className={cx('metric-note')}>
            {'Cash + QC at the sample valuation'}
          </span>
        </article>
        <article className={cx('metric')}>
          <span className={cx('label')}>{'AVAILABLE CASH'}</span>
          <div className={cx('metric-number')} data-value="cash">
            {money(available.cash)} <small>EUR</small>
          </div>
          <span className={cx('metric-note')} data-value="reserved">
            {money(state.cash - available.cash)} EUR reserved in orders
          </span>
        </article>
        <article className={cx('metric')}>
          <span className={cx('label')}>{'QC HOLDINGS'}</span>
          <div className={cx('metric-number')} data-value="holdings">
            {number(state.holdings)} <small>QC</small>
          </div>
          <span className={cx('metric-note')} data-value="holding-value">
            {empty
              ? 'No market valuation yet'
              : `${money(state.holdings * snapshot.price)} EUR at 112.50 EUR / QC`}
          </span>
        </article>
        <article className={cx('metric')}>
          <span className={cx('label')}>{'TOTAL PROFIT'}</span>
          <div
            className={cx(
              'metric-number',
              profit >= 0 ? 'positive' : 'negative',
            )}
            data-value="profit"
          >
            {profit >= 0 ? '+' : '−'}
            {money(Math.abs(profit))} <small>EUR</small>
          </div>
          <span
            className={cx('metric-note', profit >= 0 ? 'positive' : 'negative')}
            data-value="profit-percent"
          >
            {signed((profit / snapshot.baseline) * 100)} since joining
          </span>
        </article>
      </div>
      <div className={cx('overview-grid')}>
        <article className={cx('panel performance-panel')}>
          <div className={cx('panel-heading')}>
            <div>
              <p className={cx('eyebrow')}>{'01 / PERSONAL PERFORMANCE'}</p>
              <h2>{'Your progress, in perspective.'}</h2>
            </div>
          </div>
          <div className={cx('chart-summary')}>
            {empty ? (
              <strong>—</strong>
            ) : (
              <>
                <strong>
                  130,450<span>.00 EUR</span>
                </strong>
                <span className={cx('positive')}>↗ +30.45%</span>
              </>
            )}
          </div>
          <p className={cx('small muted')}>{'Account value'}</p>
          <div id="performance-chart" className={cx('line-chart')}>
            <PerformanceChart />
          </div>
          <div className={cx('panel-foot')}>
            <span className={cx('legend')}>
              <i className={cx('indigo-dot')} aria-hidden="true"></i>
              {' Your account'}
            </span>
            <span>
              {'Starting value '}
              <strong>{'100,000 EUR'}</strong>
            </span>
          </div>
        </article>
        <article className={cx('panel competition-panel')}>
          <div className={cx('panel-heading')}>
            <div>
              <p className={cx('eyebrow')}>{'02 / COMPETITIVE STANDING'}</p>
              <h2>{'Good company. Better competition.'}</h2>
            </div>
          </div>
          <div className={cx('rank-summary')}>
            <div>
              <span className={cx('rank-number')}>
                {empty ? (
                  '—'
                ) : (
                  <>
                    12<span>/ 142</span>
                  </>
                )}
              </span>
              <p className={cx('small muted')}>{'Your current rank'}</p>
            </div>
            <div className={cx('rank-return')}>
              <strong className={cx('positive')}>
                {empty ? '—' : '+30.45%'}
              </strong>
              <span className={cx('small muted')}>Return</span>
            </div>
          </div>
          <div className={cx('nearby-list')}>
            <Nearby period={periods.continuous} />
          </div>
          <div className={cx('panel-foot')}>
            <a href="#leaderboard" className={cx('text-link')}>
              {'Full leaderboard '}
              <span aria-hidden="true">{'↗'}</span>
            </a>
          </div>
        </article>
      </div>
      <div className={cx('bottom-grid')}>
        <article className={cx('panel market-card')}>
          <div className={cx('asset-icon')} aria-hidden="true">
            {'Q'}
          </div>
          <div>
            <span className={cx('label')}>{'QUANT COIN'}</span>
            <h3>
              {'QC '}
              <span className={cx('muted')}>{'/ EUR'}</span>
            </h3>
            <p className={cx('small muted')}>
              {'One fictional asset. Your own strategy.'}
            </p>
          </div>
          <div className={cx('market-card-price')}>
            {empty ? (
              <>
                <strong>—</strong>
                <span className={cx('small muted')}>No executions yet</span>
              </>
            ) : (
              <>
                <strong>
                  112.50 <span className={cx('muted')}>EUR</span>
                </strong>
                <span className={cx('positive small')}>
                  +5.34% · sample session
                </span>
              </>
            )}
          </div>
          <a href="#trade" className={cx('button')}>
            {'Trade QC '}
            <span aria-hidden="true">{'↗'}</span>
          </a>
        </article>
        <article className={cx('panel api-callout')}>
          <span className={cx('code-mark')} aria-hidden="true">
            {'</>'}
          </span>
          <div>
            <h3>{'Build your own edge.'}</h3>
            <p className={cx('small muted')}>
              {'Prefer code? Explore the API account preview.'}
            </p>
          </div>
          <a
            href="#account"
            className={cx('icon-link')}
            aria-label="Explore API and Account"
          >
            {'↗'}
          </a>
        </article>
      </div>
    </section>
  );
}
