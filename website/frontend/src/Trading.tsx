/**
 * Order ticket, public depth, and own order/fill tables over the active TradingSource.
 * @implemented-ui Controlled form, Buy/Sell selection, labels, field feedback/focus,
 *   exact decimal estimate, disabled states with explanations, and tables.
 * Validation and outcomes come from the source (mock simulation or exchange).
 */
import { UnstyledButton } from '@mantine/core';
import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import { cx, money, number } from './styles';
import { useTrading } from './trading/context.tsx';
import type { Decimal } from './trading/decimal.ts';
import { add, mul, normalizeInput, toNumber } from './trading/decimal.ts';
import type {
  AccountView,
  OrderStatus,
  Outcome,
  Side,
  TradingSource,
} from './trading/types.ts';

/** Participant-facing explanation when private account data is not shown. */
export function accountMessage(account: AccountView, subject: string) {
  switch (account.status) {
    case 'signed-out':
      return `Connect an API token on the API / Account page to see your ${subject}.`;
    case 'connecting':
      return `Loading your ${subject}…`;
    case 'rejected':
      return 'The API token was not accepted. Enter a valid token to continue.';
    case 'no-read':
      return `This token cannot read account data. Use a token with read access to see your ${subject}.`;
    case 'not-provisioned':
      return 'This account has no trading allocation on the exchange.';
    default:
      return '';
  }
}

/** Why the ticket cannot submit right now, or null when it can. */
function blocked({ account, market, trading }: TradingSource): string | null {
  if (account.status !== 'ready')
    return account.status === 'stale'
      ? 'Reconnecting to the exchange. Trading resumes once your account is up to date.'
      : accountMessage(account, 'balances');
  if (!account.canTrade)
    return 'This token is read-only. Use a token with trade access to place or cancel orders.';
  if (market.status !== 'ready')
    return 'Waiting for the order book. Trading resumes once the market is up to date.';
  if (trading.unresolved) return trading.unresolved;
  return null;
}

/** @implemented-ui Form state, exact estimate, and focus; outcomes come from the source. */
export function OrderTicket() {
  const source = useTrading();
  const { account, market, trading } = source;
  const base = market.instrument?.baseAsset ?? '';
  const quote = market.instrument?.quoteAsset ?? '';
  const [side, setSide] = useState<Side>('buy');
  // The mock keeps its reviewed sample values; live mode starts empty.
  const sample = source.kind === 'mock';
  const [price, setPrice] = useState(sample ? '110.00' : '');
  const [quantity, setQuantity] = useState(sample ? '10' : '');
  const [validation, setValidation] = useState<Outcome | null>(null);
  const priceRef = useRef<HTMLInputElement>(null),
    quantityRef = useRef<HTMLInputElement>(null);
  const reason = blocked(source);
  const field = validation?.kind === 'rejected' ? validation.field : undefined;
  const typedPrice = normalizeInput(price);
  const typedQuantity = normalizeInput(quantity);
  const estimate: Decimal | null =
    typedPrice && typedQuantity ? mul(typedPrice, typedQuantity) : null;
  const ready = account.status === 'ready' || account.status === 'stale';
  return (
    <form
      id="order-form"
      noValidate
      onInput={() => {
        setValidation(null);
        trading.clearFeedback();
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (reason || trading.busy) return;
        const result = await trading.submit({ side, price, quantity });
        setValidation(result);
        if (result.kind === 'rejected' && result.field)
          (result.field === 'price' ? priceRef : quantityRef).current?.focus();
      }}
    >
      <fieldset className={cx('side-control')}>
        <legend className={cx('sr-only')}>Order side</legend>
        {(['buy', 'sell'] as const).map((value) => (
          <label key={value}>
            <input
              type="radio"
              name="side"
              value={value}
              checked={side === value}
              onChange={() => setSide(value)}
            />
            <span>
              {value === 'buy' ? 'Buy' : 'Sell'} {base}
            </span>
          </label>
        ))}
      </fieldset>
      <div className={cx('form-available')}>
        <span>{side === 'buy' ? 'Available cash' : 'Available holdings'}</span>
        <strong>
          {!ready
            ? '—'
            : side === 'buy'
              ? `${money(account.cash.available)} ${quote}`
              : `${number(account.asset.available)} ${base}`}
        </strong>
      </div>
      <label className={cx('field-label')} htmlFor="limit-price">
        Limit price
      </label>
      <div className={cx('input-with-unit')}>
        <input
          ref={priceRef}
          id="limit-price"
          name="price"
          inputMode="decimal"
          autoComplete="off"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          aria-invalid={field === 'price' || undefined}
          aria-describedby="price-error"
        />
        <span>{quote}</span>
      </div>
      <p id="price-error" className={cx('field-error')}>
        {field === 'price' ? validation?.message : ''}
      </p>
      <label className={cx('field-label')} htmlFor="quantity">
        Quantity
      </label>
      <div className={cx('input-with-unit')}>
        <input
          ref={quantityRef}
          id="quantity"
          name="quantity"
          inputMode="decimal"
          autoComplete="off"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          aria-invalid={field === 'quantity' || undefined}
          aria-describedby="quantity-error"
        />
        <span>{base}</span>
      </div>
      <p id="quantity-error" className={cx('field-error')}>
        {field === 'quantity' ? validation?.message : ''}
      </p>
      <div className={cx('order-total')}>
        <span>Limit value</span>
        <strong>{estimate ? `${money(estimate)} ${quote}` : '—'}</strong>
      </div>
      <UnstyledButton
        className={cx('button', side === 'sell' && 'sell-button')}
        id="submit-order"
        type="submit"
        disabled={!!reason || trading.busy}
        aria-busy={trading.busy || undefined}
        aria-describedby={reason ? 'ticket-blocked' : undefined}
      >
        Place limit {side} <span aria-hidden="true">↗</span>
      </UnstyledButton>
      {reason && (
        <p id="ticket-blocked" className={cx('small muted')}>
          {reason}
        </p>
      )}
      <p
        className={cx(
          'inline-feedback',
          (trading.feedback?.kind === 'rejected' ||
            trading.feedback?.kind === 'unresolved') &&
            'is-error',
        )}
        id="order-feedback"
        role="status"
        aria-live="polite"
      >
        {trading.busy ? 'Sending order…' : trading.feedback?.message}
      </p>
    </form>
  );
}
/** @implemented-ui Public depth rows from the source's synchronized book. */
export function BookRows({ side }: { side: 'asks' | 'bids' }) {
  const { market, kind } = useTrading();
  if (!market.book)
    return (
      <tr>
        <td colSpan={3} className={cx('empty-cell')}>
          {market.status === 'unavailable'
            ? 'Order book unavailable'
            : 'Loading order book…'}
        </td>
      </tr>
    );
  let cumulative: Decimal = '0';
  const quotes = market.book[side].map(({ price, quantity }) => {
    cumulative = add(cumulative, quantity);
    return { price, quantity, total: cumulative };
  });
  const deepest = Math.max(toNumber(cumulative), Number.MIN_VALUE);
  if (side === 'asks') quotes.reverse();
  if (!quotes.length)
    return (
      <tr>
        <td colSpan={3} className={cx('empty-cell')}>
          {kind === 'mock' ? 'No sample liquidity' : 'No resting orders'}
        </td>
      </tr>
    );
  return quotes.map(({ price, quantity, total }) => (
    <tr
      key={price}
      style={
        {
          '--depth': `${(toNumber(total) / deepest) * 100}%`,
        } as CSSProperties
      }
    >
      <td className={cx(side === 'asks' ? 'negative' : 'positive')}>
        {money(price)}
      </td>
      <td>{number(quantity)}</td>
      <td className={cx('muted')}>{number(total)}</td>
    </tr>
  ));
}
const statusLabel: Record<OrderStatus, string> = {
  open: 'Open',
  partially_filled: 'Partly filled',
  filled: 'Filled',
  cancelled: 'Cancelled',
};
const statusClass: Record<OrderStatus, string> = {
  open: 'open',
  partially_filled: 'open',
  filled: 'filled',
  cancelled: 'cancelled',
};
/** @implemented-ui Own order rows, cancel affordance, and focus after cancellation. */
export function OrderRows() {
  const source = useTrading();
  const { account, trading } = source;
  const cancelled = useRef(false);
  useEffect(() => {
    if (!cancelled.current) return;
    cancelled.current = false;
    (
      document.querySelector<HTMLButtonElement>(
        '#orders-body button:not([disabled])',
      ) ?? document.querySelector<HTMLButtonElement>('#submit-order')
    )?.focus({ preventScroll: true });
  });
  if (account.status !== 'ready' && account.status !== 'stale')
    return (
      <tr>
        <td className={cx('empty-cell')} colSpan={6}>
          {accountMessage(account, 'orders')}
        </td>
      </tr>
    );
  if (!account.orders.length)
    return (
      <tr>
        <td className={cx('empty-cell')} colSpan={6}>
          No orders yet. Your submitted orders will appear here.
        </td>
      </tr>
    );
  const canCancel =
    account.status === 'ready' &&
    account.canTrade &&
    source.market.status === 'ready' &&
    !trading.busy;
  return account.orders.map((order) => (
    <tr key={order.id}>
      <td>{order.label}</td>
      <td className={cx(order.side === 'buy' ? 'positive' : 'negative')}>
        {order.side === 'buy' ? 'Buy' : 'Sell'}
      </td>
      <td>{money(order.price)}</td>
      <td>
        {number(order.remaining)}{' '}
        <span className={cx('muted')}>/ {number(order.quantity)}</span>
      </td>
      <td>
        <span className={cx('order-status', statusClass[order.status])}>
          {statusLabel[order.status]}
        </span>
      </td>
      <td>
        {order.status === 'open' || order.status === 'partially_filled' ? (
          <UnstyledButton
            className={cx('cancel-button')}
            type="button"
            aria-label={`Cancel order ${order.label}`}
            disabled={!canCancel}
            title={
              account.canTrade
                ? undefined
                : 'Requires a token with trade access'
            }
            onClick={() => {
              cancelled.current = true;
              void trading.cancel(order.id);
            }}
          >
            Cancel
          </UnstyledButton>
        ) : (
          <span className={cx('muted')}>—</span>
        )}
      </td>
    </tr>
  ));
}
/** @implemented-ui Own execution rows. */
export function FillRows() {
  const { account } = useTrading();
  if (account.status !== 'ready' && account.status !== 'stale')
    return (
      <tr>
        <td className={cx('empty-cell')} colSpan={4}>
          {accountMessage(account, 'fills')}
        </td>
      </tr>
    );
  if (!account.fills.length)
    return (
      <tr>
        <td className={cx('empty-cell')} colSpan={4}>
          No fills yet. Open orders have not executed.
        </td>
      </tr>
    );
  return account.fills.map((fill) => (
    <tr key={fill.id}>
      <td className={cx('muted')}>{fill.time}</td>
      <td className={cx(fill.side === 'buy' ? 'positive' : 'negative')}>
        {fill.side === 'buy' ? 'Buy' : 'Sell'}
      </td>
      <td>{money(fill.price)}</td>
      <td>{number(fill.quantity)}</td>
    </tr>
  ));
}
