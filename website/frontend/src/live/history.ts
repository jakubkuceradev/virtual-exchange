/**
 * @implemented-ui Bounded public price history: the most recent window of
 * one-minute candles built only from actual executions.
 *
 * - Retains candles, never trades, so memory and per-trade work stay constant
 *   however long the exchange has run.
 * - Trade IDs are per-process increasing integers; one watermark deduplicates
 *   REST pages against stream events. A new process discards the instance.
 * - Empty buckets are omitted, never filled; prices are never carried forward.
 * - When the backfill could not reach the window start, the oldest bucket may be
 *   partial; it is dropped and `coverageStart` reports where real data begins.
 */
import type { Decimal } from '../trading/decimal.ts';
import { add, cmp } from '../trading/decimal.ts';
import type { Candle, Chart, MarketStats } from '../trading/types.ts';
import type { WireTrade } from './wire.ts';

export const HISTORY_INTERVAL_MS = 60_000;
export const HISTORY_BUCKETS = 60;
export const HISTORY_WINDOW_MS = HISTORY_INTERVAL_MS * HISTORY_BUCKETS;

type Bucket = Candle & { volume: Decimal };

const EMPTY_CHART: Chart = { candles: [], interval: HISTORY_INTERVAL_MS };

function tradeNumber(trade: WireTrade): bigint | null {
  return /^\d+$/.test(trade.tradeId) ? BigInt(trade.tradeId) : null;
}

/** Start of the bucket containing `time`. */
export function bucketOf(time: number) {
  return Math.floor(time / HISTORY_INTERVAL_MS) * HISTORY_INTERVAL_MS;
}

/** Earliest bucket start inside the window that ends with the bucket of `time`. */
export function windowStart(time: number) {
  return bucketOf(time) - (HISTORY_BUCKETS - 1) * HISTORY_INTERVAL_MS;
}

export class MarketHistory {
  private buckets: Bucket[] = [];
  private watermark: bigint | null = null;
  /** Bounded fallback for non-numeric IDs (not produced by the current exchange). */
  private readonly recentIds = new Set<string>();
  private latest: number | null = null;
  private last: Decimal | null = null;
  /** First bucket backed by complete data; null when history reaches exchange start. */
  private start: number | null = null;
  private dirty = true;
  private cachedChart: Chart = EMPTY_CHART;
  private cachedStats: MarketStats | null = null;
  /** Increments on every visible change; lets callers reuse derived objects. */
  version = 0;

  /** Newest trade ID applied, for incremental recovery after a resubscribe. */
  get appliedThrough(): bigint | null {
    return this.watermark;
  }

  get lastPrice(): Decimal | null {
    return this.last;
  }

  /** True when `trade` is already reflected (at or below the watermark). */
  has(trade: WireTrade): boolean {
    const id = tradeNumber(trade);
    if (id === null) return this.recentIds.has(trade.tradeId);
    return this.watermark !== null && id <= this.watermark;
  }

  /**
   * Install backfilled trades (any order). `complete` is false when paging
   * stopped before reaching the window start or the beginning of history.
   */
  load(trades: readonly WireTrade[], complete: boolean) {
    const fresh = trades
      .filter((trade) => !this.has(trade))
      .sort((a, b) => {
        const x = tradeNumber(a) ?? 0n,
          y = tradeNumber(b) ?? 0n;
        return x < y ? -1 : x > y ? 1 : a.executedAt - b.executedAt;
      });
    const firstLoad = this.buckets.length === 0 && this.watermark === null;
    for (const trade of fresh) this.apply(trade);
    if (firstLoad && !complete && fresh[0]) {
      const partial = bucketOf(fresh[0].executedAt);
      this.buckets = this.buckets.filter((bucket) => bucket.start > partial);
      this.start = partial + HISTORY_INTERVAL_MS;
    }
    this.prune();
    this.touch();
  }

  /** Apply one live trade; returns true when anything visible changed. */
  add(trade: WireTrade): boolean {
    if (this.has(trade)) return false;
    this.apply(trade);
    this.prune();
    this.touch();
    return true;
  }

  /** Drop buckets that left the window as the clock advanced. */
  advance(now: number): boolean {
    if (this.latest === null || now <= this.latest) return false;
    this.latest = now;
    const before = this.buckets.length;
    this.prune();
    if (this.buckets.length === before) return false;
    this.touch();
    return true;
  }

  /** Candles oldest first; the same object until the next visible change. */
  get chart(): Chart {
    this.refresh();
    return this.cachedChart;
  }

  /** Statistics over the retained window; same object until the next change. */
  get stats(): MarketStats | null {
    this.refresh();
    return this.cachedStats;
  }

  /**
   * Where complete data begins, or null when the whole window (or all history
   * since exchange start) is covered.
   */
  get coverageStart(): number | null {
    if (this.start === null || this.latest === null) return null;
    return this.start > windowStart(this.latest) ? this.start : null;
  }

  private apply(trade: WireTrade) {
    const id = tradeNumber(trade);
    if (id === null) {
      this.recentIds.add(trade.tradeId);
      if (this.recentIds.size > 1000) {
        const oldest = this.recentIds.values().next().value;
        if (oldest !== undefined) this.recentIds.delete(oldest);
      }
    } else if (this.watermark === null || id > this.watermark)
      this.watermark = id;
    this.last = trade.price;
    if (this.latest === null || trade.executedAt > this.latest)
      this.latest = trade.executedAt;
    const start = bucketOf(trade.executedAt);
    // Executions arrive in ID order, which matches time order; search from the end.
    let index = this.buckets.length - 1;
    while (index >= 0 && (this.buckets[index]?.start ?? 0) > start) index--;
    const bucket = this.buckets[index];
    if (bucket && bucket.start === start) {
      if (cmp(trade.price, bucket.high) > 0) bucket.high = trade.price;
      if (cmp(trade.price, bucket.low) < 0) bucket.low = trade.price;
      bucket.close = trade.price;
      bucket.volume = add(bucket.volume, trade.quantity);
    } else
      this.buckets.splice(index + 1, 0, {
        start,
        open: trade.price,
        high: trade.price,
        low: trade.price,
        close: trade.price,
        volume: trade.quantity,
      });
  }

  private prune() {
    if (this.latest === null) return;
    const first = windowStart(this.latest);
    let drop = 0;
    while (
      drop < this.buckets.length &&
      (this.buckets[drop]?.start ?? 0) < first
    )
      drop++;
    if (drop) this.buckets.splice(0, drop);
  }

  private touch() {
    this.dirty = true;
    this.version++;
  }

  private refresh() {
    if (!this.dirty) return;
    this.dirty = false;
    const first = this.buckets[0];
    if (!first) {
      this.cachedChart = EMPTY_CHART;
      this.cachedStats = null;
      return;
    }
    let high = first.high,
      low = first.low,
      volume: Decimal = '0';
    const candles: Candle[] = [];
    for (const bucket of this.buckets) {
      if (cmp(bucket.high, high) > 0) high = bucket.high;
      if (cmp(bucket.low, low) < 0) low = bucket.low;
      volume = add(volume, bucket.volume);
      candles.push({
        start: bucket.start,
        open: bucket.open,
        high: bucket.high,
        low: bucket.low,
        close: bucket.close,
      });
    }
    this.cachedChart = { candles, interval: HISTORY_INTERVAL_MS };
    this.cachedStats = { first: first.open, high, low, volume };
  }
}
