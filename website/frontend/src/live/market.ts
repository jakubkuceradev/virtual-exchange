/**
 * @implemented-ui Pure public-market state built only from exchange observations.
 * Book: complete subscription snapshot, then absolute level quantities (zero removes).
 * Trades: deduplicated by execution ID; candles and statistics derive from them only —
 * no fabricated history, zero-price candles, or carried-forward prices.
 */
import type { Decimal } from '../trading/decimal.ts';
import { add, cmp, isZero } from '../trading/decimal.ts';
import type {
  Book,
  Candle,
  Chart,
  MarketStats,
  Side,
} from '../trading/types.ts';
import type { WireLevel, WireLevelChange, WireTrade } from './wire.ts';
import { level, levelChange, list, object, trade } from './wire.ts';

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

/** Executions keyed by trade ID; IDs are per-process counters, so order by ID. */
export type Trades = ReadonlyMap<string, WireTrade>;

export function mergeTrades(trades: Trades, payload: unknown): Trades {
  const next = new Map(trades);
  for (const entry of list(payload, 'trades').map(trade))
    next.set(entry.tradeId, entry);
  return next;
}

function byExecution(a: WireTrade, b: WireTrade) {
  const x = BigInt(/^\d+$/.test(a.tradeId) ? a.tradeId : '0'),
    y = BigInt(/^\d+$/.test(b.tradeId) ? b.tradeId : '0');
  return x < y ? -1 : x > y ? 1 : a.executedAt - b.executedAt;
}

export function ordered(trades: Trades): WireTrade[] {
  return [...trades.values()].sort(byExecution);
}

const INTERVALS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  4 * 60 * 60_000,
  24 * 60 * 60_000,
];
const MAX_CANDLES = 60;

/** Smallest interval that shows the whole history in at most ~60 buckets. */
export function chooseInterval(first: number, last: number): number {
  const span = Math.max(0, last - first);
  return (
    INTERVALS.find(
      (interval) => Math.floor(span / interval) + 1 <= MAX_CANDLES,
    ) ??
    INTERVALS[INTERVALS.length - 1] ??
    60_000
  );
}

/** OHLC buckets of actual executions. Empty buckets are omitted, never filled. */
export function candles(sorted: readonly WireTrade[]): Chart {
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) return { candles: [], interval: INTERVALS[0] ?? 60_000 };
  const interval = chooseInterval(first.executedAt, last.executedAt);
  const buckets = new Map<number, Candle>();
  for (const entry of sorted) {
    const start = Math.floor(entry.executedAt / interval) * interval;
    const candle = buckets.get(start);
    if (!candle)
      buckets.set(start, {
        start,
        open: entry.price,
        high: entry.price,
        low: entry.price,
        close: entry.price,
      });
    else {
      if (cmp(entry.price, candle.high) > 0) candle.high = entry.price;
      if (cmp(entry.price, candle.low) < 0) candle.low = entry.price;
      candle.close = entry.price;
    }
  }
  return {
    candles: [...buckets.values()].sort((a, b) => a.start - b.start),
    interval,
  };
}

export function stats(sorted: readonly WireTrade[]): MarketStats | null {
  const first = sorted[0];
  if (!first) return null;
  let high = first.price,
    low = first.price,
    volume: Decimal = '0';
  for (const entry of sorted) {
    if (cmp(entry.price, high) > 0) high = entry.price;
    if (cmp(entry.price, low) < 0) low = entry.price;
    volume = add(volume, entry.quantity);
  }
  return { first: first.price, high, low, volume };
}
