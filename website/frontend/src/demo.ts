/**
 * MOCK BACKEND SIMULATION — never use as production exchange/authentication logic.
 * @mock-backend In-memory order matching, reservations, settlement, cancellation, and dummy-key lifecycle.
 * @mock-frontend Numeric precision, limits, account funding, session times, and simulated validation are illustrative.
 * Replace this controller with API commands/results; do not port its policy into a real client.
 * These local record types describe the demo, not the published backend contract.
 */
import type { Book } from './fixtures.ts';
import { initialBook, snapshot } from './fixtures.ts';

export type Side = 'buy' | 'sell';
export type Order = {
  id: string;
  side: Side;
  price: number;
  quantity: number;
  remaining: number;
  status: 'Open' | 'Filled' | 'Cancelled';
};
export type Fill = {
  id: string;
  side: Side;
  price: number;
  quantity: number;
  time: string;
};
export type DemoState = {
  cash: number;
  holdings: number;
  /** External sample liquidity only; own open orders are merged by book(). */
  book: Book;
  /** Most recent execution price in cents, or null before the first trade. */
  lastPrice: number | null;
  orders: Order[];
  fills: Fill[];
  credential: string | null;
  credentialVersion: number;
  nextId: number;
};
export type Feedback =
  | { message: string; error?: never }
  | { error: string; message?: never };
export type SubmitResult =
  | { order: Order; message: string; error?: never; field?: never }
  | {
      field: 'side' | 'price' | 'quantity';
      error: string;
      message?: never;
      order?: never;
    };

// A disposable, in-memory design demo, not an exchange client or policy engine.
// Cash/prices use integer cents and the demo accepts whole QC units only.
/** @mock-backend Creates a disposable simulated account/exchange; never issues real requests. */
export function createDemo(empty = false) {
  const state: DemoState = {
    cash: snapshot.cash,
    holdings: snapshot.holdings,
    book: structuredClone(initialBook),
    lastPrice: snapshot.price,
    orders: [
      {
        id: 'D-1041',
        side: 'buy',
        price: 11000,
        quantity: 50,
        remaining: 50,
        status: 'Open',
      },
    ],
    fills: [
      {
        id: 'F-0831',
        side: 'buy',
        price: 10920,
        quantity: 80,
        time: '13:42:08',
      },
    ],
    credential: 'pqc_demo_only_0142_not_a_real_secret',
    credentialVersion: 1,
    nextId: 1042,
  };
  if (empty) {
    state.orders = [];
    state.fills = [];
    state.book = { asks: [], bids: [] };
    state.lastPrice = null;
    state.cash = snapshot.baseline;
    state.holdings = 0;
  }
  function available() {
    return state.orders
      .filter((order) => order.status === 'Open')
      .reduce(
        (result, order) => {
          if (order.side === 'buy')
            result.cash -= order.price * order.remaining;
          else result.holdings -= order.remaining;
          return result;
        },
        { cash: state.cash, holdings: state.holdings },
      );
  }
  /** Public depth: external sample levels plus the participant's open remainders. */
  function book(): Book {
    const levels = {
      asks: new Map<number, number>(),
      bids: new Map<number, number>(),
    };
    for (const [price, size] of state.book.asks) levels.asks.set(price, size);
    for (const [price, size] of state.book.bids) levels.bids.set(price, size);
    for (const order of state.orders) {
      if (order.status !== 'Open') continue;
      const side = order.side === 'buy' ? levels.bids : levels.asks;
      side.set(order.price, (side.get(order.price) ?? 0) + order.remaining);
    }
    return {
      asks: [...levels.asks].sort(([a], [b]) => a - b),
      bids: [...levels.bids].sort(([a], [b]) => b - a),
    };
  }
  function submit({
    side,
    price: rawPrice,
    quantity: rawQuantity,
  }: {
    side: string;
    price: string;
    quantity: string;
  }): SubmitResult {
    if (!['buy', 'sell'].includes(side))
      return { field: 'side', error: 'Choose Buy or Sell.' };
    const priceText = String(rawPrice).trim();
    if (
      !/^\d+(\.\d{1,2})?$/.test(priceText) ||
      Number(priceText) <= 0 ||
      Number(priceText) > 1000000
    )
      return {
        field: 'price',
        error:
          'Enter a price from 0.01 to 1,000,000 EUR, with at most two decimals.',
      };
    const quantityText = String(rawQuantity).trim();
    if (
      !/^\d+$/.test(quantityText) ||
      Number(quantityText) < 1 ||
      Number(quantityText) > 1000000
    )
      return {
        field: 'quantity',
        error: 'Enter a whole quantity from 1 to 1,000,000 QC.',
      };
    const price = Math.round(Number(priceText) * 100);
    const quantity = Number(quantityText);
    const resources = available();
    if (side === 'buy' && price * quantity > resources.cash)
      return {
        field: 'quantity',
        error: 'Not enough available cash for this order at its limit price.',
      };
    if (side === 'sell' && quantity > resources.holdings)
      return {
        field: 'quantity',
        error:
          'Not enough available QC. Cancel an open sell order to release holdings.',
      };
    const order: Order = {
      id: `D-${state.nextId++}`,
      side: side === 'buy' ? 'buy' : 'sell',
      price,
      quantity,
      remaining: quantity,
      status: 'Open',
    };
    const quotes = side === 'buy' ? state.book.asks : state.book.bids;
    const opposite: Side = side === 'buy' ? 'sell' : 'buy';
    const crosses = (level: number) =>
      side === 'buy' ? level <= price : level >= price;
    const ownMakers = state.orders.filter(
      (item) => item.status === 'Open' && item.side === opposite,
    );
    const levels = [
      ...new Set([
        ...quotes.map(([level]) => level),
        ...ownMakers.map((item) => item.price),
      ]),
    ]
      .filter(crosses)
      .sort((a, b) => (side === 'buy' ? a - b : b - a));
    let executed = 0;
    let prevented = 0;
    for (const level of levels) {
      if (!order.remaining) break;
      // Sample liquidity predates the session, so it keeps priority at a level.
      const quote = quotes.find(([quoted]) => quoted === level);
      const filled = Math.min(order.remaining, quote?.[1] ?? 0);
      if (quote && filled) {
        order.remaining -= filled;
        quote[1] -= filled;
        executed += filled;
        const direction = side === 'buy' ? 1 : -1;
        state.cash -= direction * level * filled;
        state.holdings += direction * filled;
        state.lastPrice = level;
        state.fills.unshift({
          id: `F-${order.id}-${state.fills.length}`,
          side: order.side,
          price: level,
          quantity: filled,
          time: new Date(Date.UTC(2026, 10, 7, 14, 46, state.fills.length))
            .toISOString()
            .slice(11, 19),
        });
      }
      // Self-trade prevention removes crossing quantity from both own orders
      // without an execution. Older own orders (end of the list) go first.
      for (const maker of ownMakers
        .filter((item) => item.price === level)
        .reverse()) {
        if (!order.remaining) break;
        const removed = Math.min(order.remaining, maker.remaining);
        order.remaining -= removed;
        maker.remaining -= removed;
        prevented += removed;
        if (!maker.remaining) maker.status = 'Cancelled';
      }
    }
    state.book.asks = state.book.asks.filter(([, size]) => size > 0);
    state.book.bids = state.book.bids.filter(([, size]) => size > 0);
    order.status = order.remaining
      ? 'Open'
      : prevented
        ? 'Cancelled'
        : 'Filled';
    state.orders.unshift(order);
    const parts = [
      executed && `${executed} QC filled within your limit.`,
      prevented &&
        `${prevented} QC not executed because it would have traded with your own order.`,
      order.remaining
        ? executed || prevented
          ? `${order.remaining} QC remains open.`
          : `limit ${side} for ${quantity} QC placed. Your order is open.`
        : executed && !prevented
          ? 'Order complete.'
          : '',
    ].filter(Boolean);
    const message = `${order.id}: ${parts.join(' ')}`;
    return { order, message };
  }
  function cancel(id: string): Feedback {
    const order = state.orders.find((item) => item.id === id);
    if (order?.status !== 'Open')
      return { error: 'This order is no longer open.' };
    order.status = 'Cancelled';
    return {
      message: `${id} cancelled. Unfilled ${order.remaining} QC released from the order.`,
    };
  }
  function createCredential(): Feedback {
    if (state.credential)
      return {
        error: 'Revoke the current sample key before creating another.',
      };
    state.credential = `pqc_demo_only_0142_v${++state.credentialVersion}_not_a_real_secret`;
    return {
      message: 'New sample key created. This key cannot access a real account.',
    };
  }
  function revokeCredential(): Feedback {
    if (!state.credential) return { error: 'There is no active sample key.' };
    state.credential = null;
    return {
      message:
        'Sample key revoked. Create a new key to continue the demonstration.',
    };
  }
  return {
    state,
    available,
    book,
    submit,
    cancel,
    createCredential,
    revokeCredential,
  };
}
