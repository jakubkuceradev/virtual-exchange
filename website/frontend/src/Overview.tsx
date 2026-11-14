/**
 * Overview over the active TradingSource.
 * @implemented-ui Responsive metric/panel layout; cash, holdings, reservations and
 *   the market card come from the exchange. Account value, profit, performance
 *   history, rank and nearby standings come from the source's competition view:
 *   the website backend in live mode (5-minute average mark), fixtures in mock
 *   mode. Without them the panels show unavailable states.
 * @mock-frontend The holdings card's valuation note (mock source only).
 */
import { EmptyChart, PerformanceChart } from './Charts';
import { Nearby, unrankedMessage } from './Standings';
import { cx, money, number, signed } from './styles';
import { change } from './Trade';
import { accountMessage } from './Trading';
import { useTrading } from './trading/context.tsx';
import type { Decimal } from './trading/decimal.ts';
import { cmp, isZero, mul, sub, toNumber } from './trading/decimal.ts';

const abs = (value: Decimal) => value.replace(/^-/, '');
/** Backend values carry 8 decimal places; show cents. */
const cents = (value: Decimal) => {
  const [whole, fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(2, '0').slice(0, 2)}`;
};

/** @implemented-ui Account metrics and competition panels from the source. */
export function Overview({ active }: { active: boolean }) {
  const { kind, market, account, competition, identity } = useTrading();
  const base = market.instrument?.baseAsset ?? '—';
  const quote = market.instrument?.quoteAsset ?? '—';
  const { lastPrice } = market;
  const ready = account.status === 'ready' || account.status === 'stale';
  const unavailable = ready ? '' : accountMessage(account, 'balances');
  const rankings = competition.status === 'ready' ? competition : null;
  const personal = rankings?.personal ?? null;
  const total = personal?.value == null ? null : cents(personal.value);
  const baseline = personal?.baseline ?? null;
  const profit =
    total != null && baseline != null ? sub(total, cents(baseline)) : null;
  const gaining = profit != null && cmp(profit, '0') >= 0;
  const standing = rankings?.periods.continuous ?? null;
  const own = standing?.you ?? null;
  const history = personal?.performance ?? [];
  // Live: the headline is the current value; the series holds 10-minute
  // samples. The mock keeps the sample series' last point.
  const current = kind === 'live' ? total : null;
  const latest = current != null ? toNumber(current) : (history.at(-1) ?? 0);
  const [latestWhole, latestCents] = money(latest.toFixed(2)).split('.');
  // The holdings card values holdings at the last execution price (mock only).
  const holdingValue =
    kind !== 'mock' || !ready
      ? null
      : lastPrice == null
        ? isZero(account.asset.total)
          ? '0'
          : null
        : mul(account.asset.total, lastPrice);
  const movement = change(market);
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
            {total == null ? '—' : money(total)} <small>{quote}</small>
          </div>
          <span className={cx('metric-note')}>
            {total != null
              ? kind === 'mock'
                ? `Cash + ${base} at the sample valuation`
                : `Cash + ${base} at the 5-minute average price`
              : 'Account valuation is not available yet'}
          </span>
        </article>
        <article className={cx('metric')}>
          <span className={cx('label')}>{'AVAILABLE CASH'}</span>
          <div className={cx('metric-number')} data-value="cash">
            {ready ? money(account.cash.available) : '—'} <small>{quote}</small>
          </div>
          <span className={cx('metric-note')} data-value="reserved">
            {ready
              ? `${money(account.cash.reserved)} ${quote} reserved in orders`
              : unavailable}
          </span>
        </article>
        <article className={cx('metric')}>
          <span className={cx('label')}>{`${base} HOLDINGS`}</span>
          <div className={cx('metric-number')} data-value="holdings">
            {ready ? number(account.asset.total) : '—'} <small>{base}</small>
          </div>
          <span className={cx('metric-note')} data-value="holding-value">
            {!ready
              ? unavailable
              : kind !== 'mock'
                ? `${number(account.asset.available)} available · ${number(account.asset.reserved)} reserved in orders`
                : lastPrice == null || holdingValue == null
                  ? 'No market valuation yet'
                  : `${money(holdingValue)} ${quote} at ${money(lastPrice)} ${quote} / ${base}`}
          </span>
        </article>
        <article className={cx('metric')}>
          <span className={cx('label')}>{'TOTAL PROFIT'}</span>
          <div
            className={cx(
              'metric-number',
              profit != null && (gaining ? 'positive' : 'negative'),
            )}
            data-value="profit"
          >
            {profit == null ? (
              '—'
            ) : (
              <>
                {gaining ? '+' : '−'}
                {money(abs(profit))}
              </>
            )}{' '}
            <small>{quote}</small>
          </div>
          <span
            className={cx(
              'metric-note',
              profit != null && (gaining ? 'positive' : 'negative'),
            )}
            data-value="profit-percent"
          >
            {!personal
              ? 'Profit is not calculated yet'
              : profit == null || baseline == null || isZero(baseline)
                ? 'Awaiting a market valuation'
                : `${signed((toNumber(profit) / toNumber(baseline)) * 100)} since joining`}
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
            {history.length === 0 && current == null ? (
              <strong>—</strong>
            ) : (
              <>
                <strong>
                  {latestWhole}
                  <span>
                    .{latestCents} {quote}
                  </span>
                </strong>
                {own?.returnPercent != null && (
                  <span
                    className={cx(
                      own.returnPercent >= 0 ? 'positive' : 'negative',
                    )}
                  >
                    {own.returnPercent >= 0 ? '↗' : '↘'}{' '}
                    {signed(own.returnPercent)}
                  </span>
                )}
              </>
            )}
          </div>
          <p className={cx('small muted')}>{'Account value'}</p>
          <div id="performance-chart" className={cx('line-chart')}>
            {competition.status === 'empty' ||
            (personal != null && history.length < 2) ? (
              <EmptyChart
                title="No performance history yet"
                description="Your account history will appear here."
              />
            ) : !personal ? (
              <EmptyChart
                title="Performance history unavailable"
                description={
                  rankings
                    ? 'Connect your account to see your performance.'
                    : 'Personal performance is not tracked yet.'
                }
              />
            ) : (
              <PerformanceChart series={history} times={personal.times} />
            )}
          </div>
          <div className={cx('panel-foot')}>
            <span className={cx('legend')}>
              <i className={cx('indigo-dot')} aria-hidden="true"></i>
              {' Your account'}
            </span>
            <span>
              {'Starting value '}
              <strong>
                {baseline != null ? `${number(cents(baseline))} ${quote}` : '—'}
              </strong>
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
                {own?.rank == null || !standing ? (
                  '—'
                ) : (
                  <>
                    {own.rank}
                    <span>/ {standing.participantCount}</span>
                  </>
                )}
              </span>
              <p className={cx('small muted')}>
                {own && own.rank == null
                  ? unrankedMessage(own.reason)
                  : 'Your current rank'}
              </p>
            </div>
            <div className={cx('rank-return')}>
              <strong
                className={cx(
                  (own?.returnPercent ?? 0) >= 0 ? 'positive' : 'negative',
                )}
              >
                {own?.returnPercent == null ? '—' : signed(own.returnPercent)}
              </strong>
              <span className={cx('small muted')}>Return</span>
            </div>
          </div>
          <div className={cx('nearby-list')}>
            <Nearby
              period={standing}
              empty={competition.status === 'empty'}
              you={identity?.name ?? ''}
            />
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
            {base.charAt(0)}
          </div>
          <div>
            <span className={cx('label')}>
              {(market.instrument?.baseName ?? base).toUpperCase()}
            </span>
            <h3>
              {`${base} `}
              <span className={cx('muted')}>{`/ ${quote}`}</span>
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
                  {money(lastPrice)}{' '}
                  <span className={cx('muted')}>{quote}</span>
                </strong>
                {movement && (
                  <span
                    className={cx(
                      movement.startsWith('+') ? 'positive' : 'negative',
                      'small',
                    )}
                  >
                    {`${movement} · ${market.historyNote.toLowerCase()}`}
                  </span>
                )}
              </>
            )}
          </div>
          <a href="#trade" className={cx('button')}>
            {`Trade ${base} `}
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
