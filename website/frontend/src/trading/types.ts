/**
 * @implemented-ui The one data-source contract every view consumes.
 * Implemented by the mock session (src/trading/mock.ts) and the live exchange
 * session. Amounts are decimal strings; commands resolve asynchronously.
 */
import type { Period } from '../fixtures.ts';
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

/** A published market news item. Times are epoch milliseconds. */
export type NewsItem = {
  id: string;
  headline: string;
  body: string | null;
  instrumentIds: readonly string[];
  /** Announced future event, if any. */
  eventAt: number | null;
  publishedAt: number;
};

export type NewsView = {
  status: 'connecting' | 'ready' | 'stale' | 'unavailable';
  /** Newest first. */
  items: readonly NewsItem[];
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

/** Fixture-only features that have no real source yet (mock only). */
export type Samples = {
  credentials: SampleCredentials;
};

/** One ranked participant: public rank, name and return only. */
export type Ranking = { rank: number; name: string; returnPercent: number };

/** The signed-in caller's place in one period. */
export type Position = {
  /** Null when unranked; `reason` then says why. */
  rank: number | null;
  /** Null when the account cannot be valued yet. */
  returnPercent: number | null;
  reason: string | null;
};

export type PeriodStanding = {
  participantCount: number;
  /** The top of the field. */
  leaders: Ranking[];
  /** The caller's position, or null when signed out. */
  you: Position | null;
  /** Ranks around the caller (two either side); empty when unranked/signed out. */
  nearby: Ranking[];
};

/** The caller's own valuation; never another participant's. */
export type Personal = {
  /** Portfolio value in the quote currency; null before the first valuation. */
  value: Decimal | null;
  /** Value at the continuous baseline (account creation). */
  baseline: Decimal | null;
  /** Account value history, oldest first. */
  performance: number[];
  /** Epoch milliseconds per performance point; null for the fixed sample. */
  times: number[] | null;
};

/**
 * Rankings and the caller's valuation. Live data comes from the website
 * backend; the mock source supplies fixtures. Never falls back to fixtures.
 */
export type Competition =
  | { status: 'loading' | 'unavailable' }
  /** No ranking snapshot yet (the mock's no-trades scenario). */
  | { status: 'empty' }
  | {
      status: 'ready';
      /** When the standings were computed (epoch ms); null for fixtures. */
      computedAt: number | null;
      periods: Record<Period, PeriodStanding>;
      /** Null when signed out or the caller has no valuation record. */
      personal: Personal | null;
    };

export type TradingSource = {
  kind: 'mock' | 'live';
  identity: Identity | null;
  market: MarketView;
  /** Public news feed; independent of market and account readiness. */
  news: NewsView;
  account: AccountView;
  trading: Trading;
  /** Null when the source has no credential entry (mock). */
  session: Session | null;
  /** Participant-facing notice such as an exchange restart. */
  notice: string | null;
  competition: Competition;
  /** Null in live mode: API key management is unavailable. */
  samples: Samples | null;
};
