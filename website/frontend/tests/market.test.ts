import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyLevels,
  bookFromSnapshot,
  candles,
  chooseInterval,
  mergeTrades,
  ordered,
  stats,
  toBook,
} from '../src/live/market.ts';
import { tradeRecord } from './frames.ts';

test('book applies absolute quantities and removes zero levels', () => {
  let book = bookFromSnapshot({
    bids: [{ price: '99.00', quantity: '1.0' }],
    asks: [
      { price: '101.00', quantity: '3' },
      { price: '102.00', quantity: '1' },
    ],
  });
  book = applyLevels(book, [
    { side: 'sell', price: '101.00', quantity: '0.0' },
    { side: 'buy', price: '99.50', quantity: '2' },
    { side: 'buy', price: '99.00', quantity: '4' },
  ]);
  assert.deepEqual(toBook(book), {
    bids: [
      { price: '99.5', quantity: '2' },
      { price: '99', quantity: '4' },
    ],
    asks: [{ price: '102', quantity: '1' }],
  });
});

test('trades deduplicate by execution ID across REST pages and events', () => {
  let trades = mergeTrades(new Map(), [
    tradeRecord('2', '101.00', '1'),
    tradeRecord('1', '100.00', '2'),
  ]);
  trades = mergeTrades(trades, [
    tradeRecord('2', '101.00', '1'),
    tradeRecord('3', '99.00', '0.5'),
  ]);
  const sorted = ordered(trades);
  assert.deepEqual(
    sorted.map((entry) => entry.tradeId),
    ['1', '2', '3'],
  );
  assert.deepEqual(stats(sorted), {
    first: '100.00',
    high: '101.00',
    low: '99.00',
    volume: '3.5',
  });
});

test('candles use actual executions only and omit empty buckets', () => {
  const sorted = ordered(
    mergeTrades(new Map(), [
      tradeRecord('1', '100.00', '1', '2026-11-07T12:00:05Z'),
      tradeRecord('2', '102.00', '1', '2026-11-07T12:00:40Z'),
      tradeRecord('3', '101.00', '1', '2026-11-07T12:00:50Z'),
      tradeRecord('4', '98.00', '1', '2026-11-07T12:03:10Z'),
    ]),
  );
  const chart = candles(sorted);
  assert.equal(chart.interval, 60_000);
  assert.deepEqual(
    chart.candles.map(({ open, high, low, close }) => [open, high, low, close]),
    [
      ['100.00', '102.00', '100.00', '101.00'],
      ['98.00', '98.00', '98.00', '98.00'],
    ],
  );
  assert.deepEqual(candles([]).candles, []);
  assert.equal(stats([]), null);
});

test('interval grows with history so candles stay readable', () => {
  const start = Date.UTC(2026, 10, 7);
  assert.equal(chooseInterval(start, start + 30 * 60_000), 60_000);
  assert.equal(chooseInterval(start, start + 3 * 3600_000), 5 * 60_000);
  assert.equal(chooseInterval(start, start + 12 * 3600_000), 15 * 60_000);
});
