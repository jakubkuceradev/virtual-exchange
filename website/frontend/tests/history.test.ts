import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  HISTORY_INTERVAL_MS,
  MarketHistory,
  windowStart,
} from '../src/live/history.ts';
import type { WireTrade } from '../src/live/wire.ts';
import { trade } from '../src/live/wire.ts';
import { tradeRecord } from './frames.ts';

const decode = (records: unknown[]) => records.map(trade);
function volumeOf(trades: readonly WireTrade[], start: number) {
  const fresh = new MarketHistory();
  fresh.load(
    trades.filter(
      (entry) => Math.floor(entry.executedAt / 60_000) * 60_000 === start,
    ),
  );
  return fresh.stats?.volume ?? '0';
}
const at = (minute: number, second = 0) =>
  `2026-11-07T12:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}+00:00`;

/** Production trades, newest first (as /trades returns them). */
const recorded: WireTrade[] = decode(
  JSON.parse(
    readFileSync(new URL('./data/trades.json', import.meta.url), 'utf8'),
  ),
);

test('candles use actual executions only and omit empty buckets', () => {
  const history = new MarketHistory();
  history.load(
    decode([
      tradeRecord('4', '98.00', '1', at(3, 10)),
      tradeRecord('3', '101.00', '1', at(0, 50)),
      tradeRecord('2', '102.00', '1', at(0, 40)),
      tradeRecord('1', '100.00', '1', at(0, 5)),
    ]),
  );
  assert.equal(history.chart.interval, HISTORY_INTERVAL_MS);
  assert.deepEqual(
    history.chart.candles.map(({ open, high, low, close }) => [
      open,
      high,
      low,
      close,
    ]),
    [
      ['100.00', '102.00', '100.00', '101.00'],
      ['98.00', '98.00', '98.00', '98.00'],
    ],
  );
  assert.deepEqual(history.stats, {
    first: '100.00',
    high: '102.00',
    low: '98.00',
    volume: '4',
  });
  assert.equal(history.lastPrice, '98.00');
});

test('an empty history has no candles, statistics, or price', () => {
  const history = new MarketHistory();
  history.load([]);
  assert.deepEqual(history.chart.candles, []);
  assert.equal(history.stats, null);
  assert.equal(history.lastPrice, null);
});

test('REST pages and stream events deduplicate by trade ID', () => {
  const history = new MarketHistory();
  history.load(
    decode([
      tradeRecord('2', '101.00', '1', at(0, 2)),
      tradeRecord('1', '100.00', '2', at(0, 1)),
    ]),
  );
  assert.equal(
    history.add(trade(tradeRecord('2', '101.00', '1', at(0, 2)))),
    false,
  );
  assert.equal(
    history.add(trade(tradeRecord('3', '99.00', '0.5', at(0, 3)))),
    true,
  );
  assert.equal(history.stats?.volume, '3.5');
  assert.equal(history.stats?.low, '99.00');
});

test('derived objects keep their identity until a visible change', () => {
  const history = new MarketHistory();
  history.load(decode([tradeRecord('1', '100.00', '1', at(0))]));
  const { chart, stats } = history;
  assert.equal(history.chart, chart);
  assert.equal(history.stats, stats);
  history.add(trade(tradeRecord('1', '100.00', '1', at(0))));
  assert.equal(history.chart, chart);
  history.add(trade(tradeRecord('2', '101.00', '1', at(0, 30))));
  assert.notEqual(history.chart, chart);
});

test('the window keeps the last 60 one-minute buckets as time advances', () => {
  const history = new MarketHistory();
  const base = Date.parse(at(0));
  history.load(decode([tradeRecord('1', '100.00', '1', at(0))]));
  // 59 minutes later the first bucket is still the oldest in the window.
  assert.equal(history.advance(base + 59 * 60_000), false);
  assert.equal(history.chart.candles.length, 1);
  assert.equal(history.advance(base + 60 * 60_000), true);
  assert.deepEqual(history.chart.candles, []);
  assert.equal(history.stats, null);
  // The last execution price is still known.
  assert.equal(history.lastPrice, '100.00');
});

test('a candle snapshot extended by later trades equals building from trades', () => {
  const oldestFirst = [...recorded].reverse();
  const split = Math.floor(oldestFirst.length / 2);
  const before = new MarketHistory();
  before.load(oldestFirst.slice(0, split));
  // The exchange's snapshot: the same buckets, with volume, through trade `split`.
  const snapshot = MarketHistory.fromCandles(
    before.chart.candles.map((candle) => ({
      ...candle,
      volume: volumeOf(oldestFirst.slice(0, split), candle.start),
    })),
    oldestFirst[split - 1]?.tradeId ?? null,
  );
  // Bridge pages overlap the snapshot; the watermark skips what it includes.
  snapshot.load(oldestFirst.slice(split - 20, split + 20));
  for (const entry of oldestFirst.slice(split)) snapshot.add(entry);
  const fresh = new MarketHistory();
  fresh.load(recorded);
  assert.deepEqual(snapshot.chart, fresh.chart);
  assert.deepEqual(snapshot.stats, fresh.stats);
  assert.equal(snapshot.lastPrice, fresh.lastPrice);
});

test('a snapshot without trades is empty and accepts the first trade', () => {
  const history = MarketHistory.fromCandles([], null);
  assert.deepEqual(history.chart.candles, []);
  assert.equal(
    history.add(trade(tradeRecord('1', '100.00', '1', at(0)))),
    true,
  );
  assert.equal(history.lastPrice, '100.00');
});

test('incremental updates equal a fresh load on recorded production trades', () => {
  const oldestFirst = [...recorded].reverse();
  const split = Math.floor(oldestFirst.length / 3);
  const incremental = new MarketHistory();
  incremental.load(oldestFirst.slice(0, split).reverse());
  for (const entry of oldestFirst.slice(split)) incremental.add(entry);
  // Replays and overlaps change nothing.
  for (const entry of oldestFirst.slice(split - 50, split + 50))
    incremental.add(entry);
  const fresh = new MarketHistory();
  fresh.load(recorded);
  assert.deepEqual(incremental.chart, fresh.chart);
  assert.deepEqual(incremental.stats, fresh.stats);
  assert.equal(incremental.lastPrice, recorded[0]?.price);
  const newest = recorded[0]?.executedAt ?? 0;
  assert.ok(
    incremental.chart.candles.every(
      (candle) => candle.start >= windowStart(newest),
    ),
  );
});
