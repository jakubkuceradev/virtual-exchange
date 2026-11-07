/**
 * Trade view over the active TradingSource.
 * @implemented-ui Complete responsive chart/book/ticket/orders/fills composition;
 *   instrument units, statistics, and chart metadata come from the source.
 * Mock and live sources supply the same records; see ../INTEGRATION.md.
 */
import { CandleChart, intervalLabel } from './Charts';
import { cx, money, number } from './styles';
import { BookRows, FillRows, OrderRows, OrderTicket } from './Trading';
import { useTrading } from './trading/context.tsx';
import { add, cmp, mul, sub, toNumber } from './trading/decimal.ts';
import type { MarketView } from './trading/types.ts';

/** Signed percentage change between the first and latest execution prices. */
export function change(market: MarketView): string | null {
  if (!market.stats || market.lastPrice == null) return null;
  const first = toNumber(market.stats.first);
  if (!first) return null;
  const value = ((toNumber(market.lastPrice) - first) / first) * 100;
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}%`;
}
const day = (epoch: number) =>
  new Date(epoch)
    .toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
    .toUpperCase();

/** @implemented-ui Market strip, chart, book, ticket, and own activity from the source. */
export function Trade({ active }: { active: boolean }) {
  const { market, account } = useTrading();
  const base = market.instrument?.baseAsset ?? '—';
  const quote = market.instrument?.quoteAsset ?? '—';
  const { lastPrice, stats, chart } = market;
  const ask = market.book?.asks[0]?.price;
  const bid = market.book?.bids[0]?.price;
  const movement = change(market);
  const latest = chart.candles.at(-1);
  return (
    <section data-view="trade" aria-labelledby="trade-title" hidden={!active}>
      <h1 id="trade-title" className={cx('sr-only')} tabIndex={-1}>
        {`Trade ${base}`}
      </h1>
      <div className={cx('market-strip')}>
        <div className={cx('market-name')}>
          <span className={cx('asset-icon')} aria-hidden="true">
            {base.charAt(0)}
          </span>
          <div>
            <h2>
              {`${base} `}
              <span className={cx('muted')}>{`/ ${quote}`}</span>
            </h2>
            <span className={cx('small muted')}>
              {`${market.instrument?.baseName ?? base} · fictional asset`}
            </span>
          </div>
        </div>
        <div>
          <span className={cx('label')}>{'LAST EXECUTION'}</span>
          <strong id="last-price">
            {lastPrice == null ? (
              <>
                — <small>No trades yet</small>
              </>
            ) : (
              <>
                {money(lastPrice)} <small>{quote}</small>
              </>
            )}
          </strong>
        </div>
        <div>
          <span className={cx('label')}>{`${market.statsLabel} CHANGE`}</span>
          <strong
            className={cx(
              movement != null &&
                (movement.startsWith('+') ? 'positive' : 'negative'),
            )}
          >
            {movement ?? '—'}
          </strong>
        </div>
        <div>
          <span className={cx('label')}>
            {`${market.statsLabel} HIGH / LOW`}
          </span>
          <strong className={cx('small')}>
            {stats ? `${money(stats.high)} / ${money(stats.low)}` : '— / —'}
          </strong>
        </div>
        <div>
          <span className={cx('label')}>{`${market.statsLabel} VOLUME`}</span>
          <strong>
            {stats ? (
              <>
                {number(stats.volume)} <small>{base}</small>
              </>
            ) : (
              '—'
            )}
          </strong>
        </div>
      </div>
      <div className={cx('trading-grid')}>
        <article className={cx('panel price-panel')}>
          <div className={cx('panel-heading')}>
            <h2>{'Price history'}</h2>
            <span className={cx('meta-label')}>
              {`${intervalLabel(chart.interval)} candles`}
            </span>
          </div>
          <div className={cx('chart-key')}>
            <span>{`${base} / ${quote}`}</span>
          </div>
          <div id="candlestick-chart" className={cx('candle-chart')}>
            <CandleChart chart={chart} />
          </div>
          <div className={cx('panel-foot')}>
            <span>{latest ? day(latest.start) : market.historyNote}</span>
            <span>{`Prices in ${quote}`}</span>
          </div>
        </article>
        <article className={cx('panel book-panel')}>
          <div className={cx('panel-heading')}>
            <h2>{'Order book'}</h2>
          </div>
          <div className={cx('book-table-wrap')}>
            <table className={cx('book-table')}>
              <caption className={cx('sr-only')}>
                {'Public ask orders, price and quantity'}
              </caption>
              <thead>
                <tr>
                  <th>
                    {'Price '}
                    <span>{quote}</span>
                  </th>
                  <th>
                    {'Size '}
                    <span>{base}</span>
                  </th>
                  <th>
                    {'Total '}
                    <span>{base}</span>
                  </th>
                </tr>
              </thead>
              <tbody id="asks">
                <BookRows side="asks" />
              </tbody>
            </table>
            <div className={cx('spread')}>
              <span id="book-mid">
                {ask != null && bid != null ? (
                  <>
                    {money(mul(add(ask, bid), '0.5'))} <small>{quote}</small>
                  </>
                ) : (
                  '—'
                )}
              </span>
              <span id="book-spread">
                {ask != null && bid != null && cmp(ask, bid) >= 0
                  ? `Spread ${money(sub(ask, bid))}`
                  : 'Spread unavailable'}
              </span>
            </div>
            <table className={cx('book-table')}>
              <caption className={cx('sr-only')}>
                {'Public bid orders, price and quantity'}
              </caption>
              <thead className={cx('sr-only')}>
                <tr>
                  <th>{`Price ${quote}`}</th>
                  <th>{`Size ${base}`}</th>
                  <th>{`Total ${base}`}</th>
                </tr>
              </thead>
              <tbody id="bids">
                <BookRows side="bids" />
              </tbody>
            </table>
          </div>
        </article>
        <article className={cx('panel ticket-panel')}>
          <div className={cx('panel-heading')}>
            <h2>{'Place limit order'}</h2>
          </div>
          <OrderTicket />
        </article>
      </div>
      <div className={cx('orders-grid')}>
        <article className={cx('panel')}>
          <div className={cx('panel-heading')}>
            <h2>
              {'Your orders '}
              <span id="open-count" className={cx('count')}>
                {account.status === 'ready' || account.status === 'stale'
                  ? `${
                      account.orders.filter(
                        (order) =>
                          order.status === 'open' ||
                          order.status === 'partially_filled',
                      ).length
                    } open`
                  : '—'}
              </span>
            </h2>
          </div>
          <div className={cx('table-scroll')}>
            <table className={cx('data-table orders-table')}>
              <caption className={cx('sr-only')}>
                {'Your submitted orders and cancellation controls'}
              </caption>
              <thead>
                <tr>
                  <th>{'Order'}</th>
                  <th>{'Side'}</th>
                  <th>{`Limit / ${quote}`}</th>
                  <th>{`Unfilled / ${base}`}</th>
                  <th>{'Status'}</th>
                  <th>
                    <span className={cx('sr-only')}>{'Action'}</span>
                  </th>
                </tr>
              </thead>
              <tbody id="orders-body">
                <OrderRows />
              </tbody>
            </table>
          </div>
        </article>
        <article className={cx('panel')}>
          <div className={cx('panel-heading')}>
            <h2>{'Your fills'}</h2>
          </div>
          <div className={cx('table-scroll')}>
            <table className={cx('data-table')}>
              <caption className={cx('sr-only')}>
                {'Your own executions'}
              </caption>
              <thead>
                <tr>
                  <th>{'Time'}</th>
                  <th>{'Side'}</th>
                  <th>{`Price / ${quote}`}</th>
                  <th>{`Size / ${base}`}</th>
                </tr>
              </thead>
              <tbody id="fills-body">
                <FillRows />
              </tbody>
            </table>
          </div>
        </article>
      </div>
    </section>
  );
}
