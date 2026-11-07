/**
 * @implemented-ui The one data-source contract every view consumes.
 * Implemented by the mock session (src/trading/mock.ts) and the live exchange
 * session. Amounts are decimal strings; commands resolve asynchronously.
 */
import type { Period, Standings } from '../fixtures.ts';
import type { Decimal } from './decimal.ts';

export type Side = 'buy' | 'sell';

export type Instrument = {
  id: string;
  baseAsset: string;
  quoteAsset: string;
  /** Human-readable base asset name when known (mock only). */
  baseName: string | null;
  priceIncrement: Decimal;
  quantityIncrement: Decimal;
};

export type Level = { price: Decimal; quantity: Decimal };
/** Bids best (highest) first; asks best (lowest) first. */
export type Book = { bids: Level[]; asks: Level[] };

export type OrderStatus = 'open' | 'partially_filled' | 'filled' | 'cancelled';
export type Order = {
  id: string;
  /** Short display identifier. */
  label: string;
  side: Side;
  price: Decimal;
  quantity: Decimal;
  remaining: Decimal;
  status: OrderStatus;
};
export type Fill = {
  id: string;
  side: Side;
  price: Decimal;
  quantity: Decimal;
  /** Display time (HH:MM:SS). */
  time: string;
};

export type Candle = {
  /** Bucket start, epoch milliseconds. */
  start: number;
  open: Decimal;
  high: Decimal;
  low: Decimal;
  close: Decimal;
};
export type Chart = {
  candles: Candle[];
  /** Bucket width in milliseconds. */
  interval: number;
};
/** Statistics over the market history the source actually has. */
export type MarketStats = {
  first: Decimal;
  high: Decimal;
  low: Decimal;
  volume: Decimal;
};

export type MarketView = {
  status: 'connecting' | 'ready' | 'stale' | 'unavailable';
  instrument: Instrument | null;
  /** Null until a complete book is synchronized. */
  book: Book | null;
  /** Price of the most recent execution; null before the first trade. */
  lastPrice: Decimal | null;
  chart: Chart;
  stats: MarketStats | null;
  /** Upper-case prefix naming the statistics window, e.g. "SNAPSHOT". */
  statsLabel: string;
  /** Caption describing the history window (e.g. since exchange start). */
  historyNote: string;
};

export type Holding = { total: Decimal; available: Decimal; reserved: Decimal };

export type AccountView =
  | { status: 'signed-out' }
  | { status: 'connecting' }
  | { status: 'rejected' }
  | { status: 'no-read'; accountId: string }
  | { status: 'not-provisioned'; accountId: string }
  | {
      status: 'ready' | 'stale';
      accountId: string;
      canTrade: boolean;
      cash: Holding;
      asset: Holding;
      /** Newest first. */
      orders: Order[];
      /** Newest first. */
      fills: Fill[];
    };

export type Identity = {
  accountId: string;
  name: string;
  initials: string;
  permissions: readonly string[];
};

export type OutcomeField = 'side' | 'price' | 'quantity';
export type Outcome =
  | { kind: 'accepted' | 'info'; message: string }
  | { kind: 'rejected'; message: string; field?: OutcomeField }
  | { kind: 'unresolved'; message: string };

export type OrderInput = { side: Side; price: string; quantity: string };

export type Trading = {
  /** True while a deliberate command awaits its result. */
  busy: boolean;
  /** Submission whose outcome is unknown; blocks new submissions until resolved. */
  unresolved: string | null;
  /** Re-check an unresolved submission (resync, then look it up by client ID). */
  checkUnresolved: () => void;
  /** Present once the unresolved order was not found after a resync. */
  dismissUnresolved: (() => void) | null;
  feedback: Outcome | null;
  clearFeedback: () => void;
  submit: (input: OrderInput) => Promise<Outcome>;
  cancel: (orderId: string) => Promise<Outcome>;
};

export type Session = {
  connect: (token: string) => Promise<void>;
  disconnect: () => void;
};

export type SampleCredentials = {
  key: string | null;
  create: () => Outcome;
  revoke: () => Outcome;
};

/** Fixture observations for features the exchange does not provide (mock only). */
export type Samples = {
  /** The no-trades scenario: sample history and rankings are absent. */
  empty: boolean;
  baseline: Decimal;
  performance: number[];
  periods: Record<Period, Standings>;
  participantCount: number;
  credentials: SampleCredentials;
};

export type TradingSource = {
  kind: 'mock' | 'live';
  identity: Identity | null;
  market: MarketView;
  account: AccountView;
  trading: Trading;
  /** Null when the source has no credential entry (mock). */
  session: Session | null;
  /** Participant-facing notice such as an exchange restart. */
  notice: string | null;
  /** Null in live mode: valuation, performance, rankings, and keys are unavailable. */
  samples: Samples | null;
};
