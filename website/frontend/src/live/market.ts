/**
 * @implemented-ui Pure public-market state built only from exchange observations.
 * Book: complete subscription snapshot, then absolute level quantities (zero removes).
 * Price history (candles, statistics) lives in history.ts.
 */
import type { Decimal } from '../trading/decimal.ts';
import { cmp, isZero } from '../trading/decimal.ts';
import type { Book, Side } from '../trading/types.ts';
import type { WireLevel, WireLevelChange } from './wire.ts';
import { level, levelChange, list, object } from './wire.ts';

export type BookState = {
  bids: Map<Decimal, Decimal>;
  asks: Map<Decimal, Decimal>;
};

/** Canonical map key so "100.0" and "100" address the same level. */
function key(price: Decimal): Decimal {
  if (!price.includes('.')) return price;
  const trimmed = price.replace(/0+$/, '');
  return trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
}

export function bookFromSnapshot(payload: unknown): BookState {
  const raw = object(payload, 'book snapshot');
  const side = (levels: unknown) =>
    new Map(
      list(levels, 'levels')
        .map(level)
        .filter((entry: WireLevel) => !isZero(entry.quantity))
        .map((entry): [Decimal, Decimal] => [key(entry.price), entry.quantity]),
    );
  return { bids: side(raw.bids), asks: side(raw.asks) };
}

export function applyLevels(book: BookState, payload: unknown): BookState {
  const next = { bids: new Map(book.bids), asks: new Map(book.asks) };
  for (const change of list(payload, 'level changes').map(
    levelChange,
  ) as WireLevelChange[]) {
    const levels = change.side === 'buy' ? next.bids : next.asks;
    if (isZero(change.quantity)) levels.delete(key(change.price));
    else levels.set(key(change.price), change.quantity);
  }
  return next;
}

export function toBook(book: BookState): Book {
  const sorted = (levels: Map<Decimal, Decimal>, side: Side) =>
    [...levels]
      .map(([price, quantity]) => ({ price, quantity }))
      .sort((a, b) =>
        side === 'buy' ? cmp(b.price, a.price) : cmp(a.price, b.price),
      );
  return { bids: sorted(book.bids, 'buy'), asks: sorted(book.asks, 'sell') };
}
