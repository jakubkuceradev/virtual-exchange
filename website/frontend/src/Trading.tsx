/**
 * Trading UI works; all exchange operations and observations are simulated.
 * @mock-backend Submit/cancel, funds, public depth, orders, fills, and resulting feedback use DemoContext.
 * @mock-frontend Whole-QC precision, price limits, estimates, and validation are sample assumptions, not API contracts.
 * @implemented-ui Controlled form, Buy/Sell selection, labels, focus recovery, and tables.
 * Replace session commands/data and authoritative validation; retain reviewed controls/layout.
 */
import { UnstyledButton } from '@mantine/core';
import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useDemo } from './DemoContext';
import type { Side, SubmitResult } from './demo.ts';
import { cx, money, number } from './styles';

/** @mock-backend Submit/resources/results. @mock-frontend Demo precision/validation. @implemented-ui Form state and focus. */
export function OrderTicket() {
  const { available, submit, orderFeedback, clearOrderFeedback } = useDemo();
  const [side, setSide] = useState<Side>('buy');
  const [price, setPrice] = useState('110.00');
  const [quantity, setQuantity] = useState('10');
  const [validation, setValidation] = useState<SubmitResult | null>(null);
  const priceRef = useRef<HTMLInputElement>(null),
    quantityRef = useRef<HTMLInputElement>(null);
  const estimate = Number(price) * Number(quantity);
  return (
    <form
      id="order-form"
      noValidate
      onInput={() => {
        setValidation(null);
        clearOrderFeedback();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        const result = submit({ side, price, quantity });
        setValidation(result);
        if (result.error)
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
            <span>{value === 'buy' ? 'Buy' : 'Sell'} QC</span>
          </label>
        ))}
      </fieldset>
      <div className={cx('form-available')}>
        <span>{side === 'buy' ? 'Available cash' : 'Available holdings'}</span>
        <strong>
          {side === 'buy'
            ? `${money(available.cash)} EUR`
            : `${number(available.holdings)} QC`}
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
          aria-invalid={validation?.field === 'price' || undefined}
          aria-describedby="price-error"
        />
        <span>EUR</span>
      </div>
      <p id="price-error" className={cx('field-error')}>
        {validation?.field === 'price' ? validation.error : ''}
      </p>
      <label className={cx('field-label')} htmlFor="quantity">
        Quantity
      </label>
      <div className={cx('input-with-unit')}>
        <input
          ref={quantityRef}
          id="quantity"
          name="quantity"
          inputMode="numeric"
          autoComplete="off"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          aria-invalid={validation?.field === 'quantity' || undefined}
          aria-describedby="quantity-error"
        />
        <span>QC</span>
      </div>
      <p id="quantity-error" className={cx('field-error')}>
        {validation?.field === 'quantity' ? validation.error : ''}
      </p>
      <div className={cx('order-total')}>
        <span>Limit value</span>
        <strong>
          {Number.isFinite(estimate) && estimate >= 0
            ? `${money(Math.round(estimate * 100))} EUR`
            : '—'}
        </strong>
      </div>
      <UnstyledButton
        className={cx('button', side === 'sell' && 'sell-button')}
        id="submit-order"
        type="submit"
      >
        Place limit {side} <span aria-hidden="true">↗</span>
      </UnstyledButton>
      <p
        className={cx('inline-feedback', !!orderFeedback?.error && 'is-error')}
        id="order-feedback"
        role="status"
        aria-live="polite"
      >
        {orderFeedback?.error || orderFeedback?.message}
      </p>
    </form>
  );
}
/** @mock-backend Public depth from the simulation, without stream/snapshot reconciliation. @implemented-ui Depth-row rendering. */
export function BookRows({ side }: { side: 'asks' | 'bids' }) {
  const { state } = useDemo();
  let cumulative = 0;
  const quotes = state.book[side].map(([price, size]) => {
    cumulative += size;
    return { price, size, total: cumulative };
  });
  if (side === 'asks') quotes.reverse();
  if (!quotes.length)
    return (
      <tr>
        <td colSpan={3} className={cx('empty-cell')}>
          No sample liquidity
        </td>
      </tr>
    );
  return quotes.map(({ price, size, total }) => (
    <tr
      key={price}
      style={
        {
          '--depth': `${(total / Math.max(1, cumulative)) * 100}%`,
        } as CSSProperties
      }
    >
      <td className={cx(side === 'asks' ? 'negative' : 'positive')}>
        {money(price)}
      </td>
      <td>{number(size)}</td>
      <td className={cx('muted')}>{number(total)}</td>
    </tr>
  ));
}
/** @mock-backend Order history and cancel command. @implemented-ui Row rendering and focus after removal. */
export function OrderRows() {
  const { state, cancel } = useDemo();
  const cancelled = useRef(false);
  useEffect(() => {
    if (!cancelled.current) return;
    cancelled.current = false;
    (
      document.querySelector<HTMLButtonElement>('#orders-body button') ??
      document.querySelector<HTMLButtonElement>('#submit-order')
    )?.focus({ preventScroll: true });
  });
  if (!state.orders.length)
    return (
      <tr>
        <td className={cx('empty-cell')} colSpan={6}>
          No orders yet. Your submitted orders will appear here.
        </td>
      </tr>
    );
  return state.orders.map((order) => (
    <tr key={order.id}>
      <td>{order.id}</td>
      <td className={cx(order.side === 'buy' ? 'positive' : 'negative')}>
        {order.side === 'buy' ? 'Buy' : 'Sell'}
      </td>
      <td>{money(order.price)}</td>
      <td>
        {order.remaining}{' '}
        <span className={cx('muted')}>/ {order.quantity}</span>
      </td>
      <td>
        <span className={cx('order-status', order.status.toLowerCase())}>
          {order.status}
        </span>
      </td>
      <td>
        {order.status === 'Open' ? (
          <UnstyledButton
            className={cx('cancel-button')}
            type="button"
            aria-label={`Cancel order ${order.id}`}
            onClick={() => {
              cancelled.current = true;
              cancel(order.id);
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
/** @mock-backend Own executions from the simulation, without a fills API. @implemented-ui Table rendering. */
export function FillRows() {
  const { state } = useDemo();
  if (!state.fills.length)
    return (
      <tr>
        <td className={cx('empty-cell')} colSpan={4}>
          No fills yet. Open orders have not executed.
        </td>
      </tr>
    );
  return state.fills.map((fill) => (
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
