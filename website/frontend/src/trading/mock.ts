/**
 * MOCK SESSION BOUNDARY — no HTTP, WebSocket, authentication, or persistence.
 * @mock-backend Adapts the local simulation (demo.ts) to the TradingSource contract.
 * @mock-frontend The no-trades query parameter selects fabricated initial observations.
 * Converts the demo's integer cents/whole units to decimal strings at this boundary
 * so views share one record shape with the live exchange source.
 */
import { useState } from 'react';
import type { Order as DemoOrder, Feedback, SubmitResult } from '../demo.ts';
import { createDemo } from '../demo.ts';
import type { Period } from '../fixtures.ts';
import {
  candles,
  participant,
  participantCount,
  performance,
  periods,
  snapshot,
} from '../fixtures.ts';
import type { Decimal } from './decimal.ts';
import { add, fromUnits, isZero, mul } from './decimal.ts';
import type {
  Candle,
  Competition,
  Instrument,
  NewsItem,
  Order,
  Outcome,
  PeriodStanding,
  SampleCredentials,
  TradingSource,
} from './types.ts';

const cents = (value: number): Decimal => fromUnits(value, 2);
const whole = (value: number): Decimal => String(value);

export const mockInstrument: Instrument = {
  id: 'QC-EUR',
  baseAsset: 'QC',
  quoteAsset: 'EUR',
  baseName: 'Quant Coin',
  priceIncrement: '0.01',
  quantityIncrement: '1',
};

const CANDLE_INTERVAL = 15 * 60 * 1000;
// Local wall-clock times so axis labels read 09:00–14:45 in any time zone.
const CANDLE_START = new Date(2026, 10, 7, 9, 0).getTime();
// Fixture candles are fractional EUR numbers; render them as cent decimals.
const sampleCandles: Candle[] = candles.map(
  ([open, high, low, close], index) => ({
    start: CANDLE_START + index * CANDLE_INTERVAL,
    open: cents(Math.round(open * 100)),
    high: cents(Math.round(high * 100)),
    low: cents(Math.round(low * 100)),
    close: cents(Math.round(close * 100)),
  }),
);
const sampleStats = {
  first: sampleCandles[0]?.open ?? '0',
  high: '113.20',
  low: '106.20',
  volume: '18420',
};

/** @mock-backend Sample news timed relative to page load; one announces an upcoming event. */
function sampleNews(now: number): NewsItem[] {
  const minute = 60_000;
  return [
    {
      id: 'sample-news-3',
      headline: 'Quant Coin foundation to publish quarterly reserves report',
      body: 'The report is expected to cover treasury holdings and the planned token buyback.',
      instrumentIds: ['QC-EUR'],
      eventAt: now + 25 * minute,
      publishedAt: now - 2 * minute,
    },
    {
      id: 'sample-news-2',
      headline: 'Large holder moves QC to an exchange wallet',
      body: null,
      instrumentIds: ['QC-EUR'],
      eventAt: null,
      publishedAt: now - 18 * minute,
    },
    {
      id: 'sample-news-1',
      headline: 'Trading session open: good luck to all participants',
      body: 'Market data and order entry are available until the end of the session.',
      instrumentIds: [],
      eventAt: null,
      publishedAt: now - 64 * minute,
    },
  ];
}

function order(item: DemoOrder): Order {
  return {
    id: item.id,
    label: item.id,
    side: item.side,
    price: cents(item.price),
    quantity: whole(item.quantity),
    remaining: whole(item.remaining),
    status:
      item.status === 'Open'
        ? 'open'
        : item.status === 'Filled'
          ? 'filled'
          : 'cancelled',
  };
}

function outcome(result: Feedback | SubmitResult): Outcome {
  if (result.error)
    return 'field' in result && result.field
      ? { kind: 'rejected', message: result.error, field: result.field }
      : { kind: 'rejected', message: result.error };
  return { kind: 'accepted', message: result.message ?? '' };
}

/** Fixture standings in the shared shape; ranks are explicit. */
function standing(period: Period): PeriodStanding {
  const sample = periods[period];
  return {
    participantCount,
    leaders: sample.leaders.map(([name, returnPercent], index) => ({
      rank: index + 1,
      name,
      returnPercent,
    })),
    you: { rank: sample.rank, returnPercent: sample.profit, reason: null },
    nearby: sample.nearby.map(([name, returnPercent], index) => ({
      rank: sample.rank - 2 + index,
      name,
      returnPercent,
    })),
  };
}

/**
 * @mock-backend Sample competition: fixture rankings and history.
 * @mock-frontend Sample valuation: cash plus holdings at the latest execution price.
 */
function sampleCompetition(
  empty: boolean,
  cash: Decimal,
  holdings: Decimal,
  lastPrice: Decimal | null,
): Competition {
  if (empty) return { status: 'empty' };
  const value =
    lastPrice != null
      ? add(cash, mul(holdings, lastPrice))
      : isZero(holdings)
        ? cash
        : null;
  return {
    status: 'ready',
    computedAt: null,
    periods: {
      continuous: standing('continuous'),
      weekly: standing('weekly'),
      monthly: standing('monthly'),
      yearly: standing('yearly'),
    },
    personal: {
      value,
      baseline: cents(snapshot.baseline),
      performance,
      times: null,
    },
  };
}

/** @mock-backend Local controller and state adapter, not an authenticated service session. */
export function useMockSource(): TradingSource {
  const [empty] = useState(
    () => new URLSearchParams(location.search).get('scenario') === 'no-trades',
  );
  const [demo] = useState(() => createDemo(empty));
  const [news] = useState(() => (empty ? [] : sampleNews(Date.now())));
  const [, setVersion] = useState(0);
  const [feedback, setFeedback] = useState<Outcome | null>(null);
  function run<T>(command: () => T): T {
    const result = command();
    setVersion((version) => version + 1);
    return result;
  }
  const { state } = demo;
  const available = demo.available();
  const book = demo.book();
  const credentials: SampleCredentials = {
    key: state.credential,
    create: () => outcome(run(() => demo.createCredential())),
    revoke: () => outcome(run(() => demo.revokeCredential())),
  };
  return {
    kind: 'mock',
    identity: {
      accountId: participant.id,
      name: participant.name,
      initials: participant.initials,
      permissions: ['read', 'trade'],
    },
    market: {
      status: 'ready',
      instrument: mockInstrument,
      book: {
        bids: book.bids.map(([price, size]) => ({
          price: cents(price),
          quantity: whole(size),
        })),
        asks: book.asks.map(([price, size]) => ({
          price: cents(price),
          quantity: whole(size),
        })),
      },
      lastPrice: state.lastPrice == null ? null : cents(state.lastPrice),
      chart: {
        candles: empty ? [] : sampleCandles,
        interval: CANDLE_INTERVAL,
      },
      stats: empty ? null : sampleStats,
      statsLabel: 'SNAPSHOT',
      historyNote: 'Sample session',
    },
    news: { status: 'ready', items: news },
    account: {
      status: 'ready',
      accountId: participant.id,
      canTrade: true,
      cash: {
        total: cents(state.cash),
        available: cents(available.cash),
        reserved: cents(state.cash - available.cash),
      },
      asset: {
        total: whole(state.holdings),
        available: whole(available.holdings),
        reserved: whole(state.holdings - available.holdings),
      },
      orders: state.orders.map(order),
      fills: state.fills.map((fill) => ({
        id: fill.id,
        side: fill.side,
        price: cents(fill.price),
        quantity: whole(fill.quantity),
        time: fill.time,
      })),
    },
    trading: {
      busy: false,
      unresolved: null,
      checkUnresolved: () => {},
      dismissUnresolved: null,
      feedback,
      clearFeedback: () => setFeedback(null),
      submit: async (input) => {
        const result = outcome(run(() => demo.submit(input)));
        setFeedback(result);
        return result;
      },
      cancel: async (id) => {
        const result = outcome(run(() => demo.cancel(id)));
        setFeedback(result);
        return result;
      },
    },
    session: null,
    notice: null,
    competition: sampleCompetition(
      empty,
      cents(state.cash),
      whole(state.holdings),
      state.lastPrice == null ? null : cents(state.lastPrice),
    ),
    samples: { credentials },
  };
}
