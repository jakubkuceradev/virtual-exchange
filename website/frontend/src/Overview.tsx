/**
 * Overview: presentation implemented, all financial/competition data mocked.
 * @mock-backend Balances, holdings, rank, nearby participants, and market snapshot.
 * @mock-frontend Fixed valuation/baseline and profit calculations are illustrative policies.
 * @implemented-ui Responsive metric/panel layout and navigation links.
 * Replace account/valuation/competition observations; retain reviewed presentation.
 */
import { PerformanceChart } from './Charts';
import { useDemo } from './DemoContext';
import {
  participantCount,
  performance,
  periods,
  snapshot,
} from './fixtures.ts';
import { Nearby } from './Standings';
import { cx, money, number, signed } from './styles';

/** @mock-backend Account/competition/market observations. @mock-frontend Valuation and profit assumptions. */
export function Overview({ active }: { active: boolean }) {
  const { state, available, empty } = useDemo();
  const { lastPrice } = state;
  // Sample valuation: cash plus holdings at the latest execution price.
  const holdingValue =
    lastPrice == null
      ? state.holdings
        ? null
        : 0
      : state.holdings * lastPrice;
  const total = holdingValue == null ? null : state.cash + holdingValue;
  const profit = total == null ? null : total - snapshot.baseline;
  const [latestWhole, latestCents] = money(
    (performance.at(-1) ?? 0) * 100,
  ).split('.');
  const standing = periods.continuous;
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
            {total == null ? '—' : money(total)} <small>EUR</small>
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
            {lastPrice == null || holdingValue == null
              ? 'No market valuation yet'
              : `${money(holdingValue)} EUR at ${money(lastPrice)} EUR / QC`}
          </span>
        </article>
        <article className={cx('metric')}>
          <span className={cx('label')}>{'TOTAL PROFIT'}</span>
          <div
            className={cx(
              'metric-number',
              profit != null && (profit >= 0 ? 'positive' : 'negative'),
            )}
            data-value="profit"
          >
            {profit == null ? (
              '—'
            ) : (
              <>
                {profit >= 0 ? '+' : '−'}
                {money(Math.abs(profit))}
              </>
            )}{' '}
            <small>EUR</small>
          </div>
          <span
            className={cx(
              'metric-note',
              profit != null && (profit >= 0 ? 'positive' : 'negative'),
            )}
            data-value="profit-percent"
          >
            {profit == null
              ? 'Awaiting a market valuation'
              : `${signed((profit / snapshot.baseline) * 100)} since joining`}
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
                  {latestWhole}
                  <span>.{latestCents} EUR</span>
                </strong>
                <span className={cx('positive')}>
                  ↗ {signed(standing.profit)}
                </span>
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
              <strong>{`${number(snapshot.baseline / 100)} EUR`}</strong>
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
                    {standing.rank}
                    <span>/ {participantCount}</span>
                  </>
                )}
              </span>
              <p className={cx('small muted')}>{'Your current rank'}</p>
            </div>
            <div className={cx('rank-return')}>
              <strong className={cx('positive')}>
                {empty ? '—' : signed(standing.profit)}
              </strong>
              <span className={cx('small muted')}>Return</span>
            </div>
          </div>
          <div className={cx('nearby-list')}>
            <Nearby period={standing} />
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
            {lastPrice == null ? (
              <>
                <strong>—</strong>
                <span className={cx('small muted')}>No executions yet</span>
              </>
            ) : (
              <>
                <strong>
                  {money(lastPrice)} <span className={cx('muted')}>EUR</span>
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
