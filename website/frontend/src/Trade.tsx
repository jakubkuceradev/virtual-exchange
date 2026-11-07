/**
 * Trade view: presentation implemented, market/account data mocked.
 * @mock-backend Last price, book, balances, orders, and fills come from the local session.
 * @mock-frontend Session change/high/low/volume, market identity, candle interval/date are fixed visual placeholders.
 * @implemented-ui Complete responsive chart/book/ticket/orders/fills composition.
 * Replace snapshot/session sources and use API instrument/market metadata.
 */
import { CandleChart } from './Charts';
import { useDemo } from './DemoContext';
import { snapshot } from './fixtures.ts';
import { cx, money } from './styles';
import { BookRows, FillRows, OrderRows, OrderTicket } from './Trading';

/** @mock-backend Market/account observations. @mock-frontend Snapshot statistics and chart metadata. */
export function Trade({ active }: { active: boolean }) {
  const { state, empty } = useDemo();
  const lastPrice =
    state.fills.find((fill) => fill.id !== 'F-0831')?.price ??
    (empty ? null : snapshot.price);
  const ask = state.book.asks[0]?.[0];
  const bid = state.book.bids[0]?.[0];
  return (
    <section data-view="trade" aria-labelledby="trade-title" hidden={!active}>
      <h1 id="trade-title" className={cx('sr-only')} tabIndex={-1}>
        {'Trade QC'}
      </h1>
      <div className={cx('market-strip')}>
        <div className={cx('market-name')}>
          <span className={cx('asset-icon')} aria-hidden="true">
            {'Q'}
          </span>
          <div>
            <h2>
              {'QC '}
              <span className={cx('muted')}>{'/ EUR'}</span>
            </h2>
            <span className={cx('small muted')}>
              {'Quant Coin · fictional asset'}
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
                {money(lastPrice)} <small>EUR</small>
              </>
            )}
          </strong>
        </div>
        <div>
          <span className={cx('label')}>{'SNAPSHOT CHANGE'}</span>
          <strong className={cx('positive')}>{empty ? '—' : '+5.34%'}</strong>
        </div>
        <div>
          <span className={cx('label')}>{'SNAPSHOT HIGH / LOW'}</span>
          <strong className={cx('small')}>
            {empty ? '— / —' : '113.20 / 106.20'}
          </strong>
        </div>
        <div>
          <span className={cx('label')}>{'SNAPSHOT VOLUME'}</span>
          <strong>
            {empty ? (
              '—'
            ) : (
              <>
                18,420 <small>QC</small>
              </>
            )}
          </strong>
        </div>
      </div>
      <div className={cx('trading-grid')}>
        <article className={cx('panel price-panel')}>
          <div className={cx('panel-heading')}>
            <h2>{'Price history'}</h2>
            <span className={cx('meta-label')}>{'15 min candles'}</span>
          </div>
          <div className={cx('chart-key')}>
            <span>{'QC / EUR'}</span>
          </div>
          <div id="candlestick-chart" className={cx('candle-chart')}>
            <CandleChart />
          </div>
          <div className={cx('panel-foot')}>
            <span>{'07 NOV 2026'}</span>
            <span>{'Prices in EUR'}</span>
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
                    <span>{'EUR'}</span>
                  </th>
                  <th>
                    {'Size '}
                    <span>{'QC'}</span>
                  </th>
                  <th>
                    {'Total '}
                    <span>{'QC'}</span>
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
                    {money((ask + bid) / 2)} <small>EUR</small>
                  </>
                ) : (
                  '—'
                )}
              </span>
              <span id="book-spread">
                {ask != null && bid != null
                  ? `Spread ${money(ask - bid)}`
                  : 'Spread unavailable'}
              </span>
            </div>
            <table className={cx('book-table')}>
              <caption className={cx('sr-only')}>
                {'Public bid orders, price and quantity'}
              </caption>
              <thead className={cx('sr-only')}>
                <tr>
                  <th>{'Price EUR'}</th>
                  <th>{'Size QC'}</th>
                  <th>{'Total QC'}</th>
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
                {state.orders.filter((order) => order.status === 'Open').length}{' '}
                open
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
                  <th>{'Limit / EUR'}</th>
                  <th>{'Unfilled / QC'}</th>
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
                  <th>{'Price / EUR'}</th>
                  <th>{'Size / QC'}</th>
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
