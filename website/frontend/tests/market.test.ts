import assert from 'node:assert/strict';
import test from 'node:test';
import { applyLevels, bookFromSnapshot, toBook } from '../src/live/market.ts';

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
