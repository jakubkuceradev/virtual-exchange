import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyBalances,
  applyFills,
  applyOrders,
  fillRows,
  holding,
  install,
  orderRows,
  snapshot,
} from '../src/live/account.ts';
import { fillRecord, orderRecord } from './frames.ts';

const base = snapshot({
  process_id: 'process-1',
  commit_id: 5,
  balances: [
    { asset_id: 'EUR', available: '800.000', reserved: '200.000' },
    { asset_id: 'QC', available: '2.0', reserved: '0.0' },
  ],
  orders: [orderRecord('a', 5)],
  fill_high_watermark: 1,
  channel_baselines: { orders: 3, fills: 1 },
});

test('order versions never regress and fills deduplicate', () => {
  let state = install(base, [fillRecord('1', 'a')]);
  state = applyOrders(state, [
    orderRecord('a', 4, { status: 'cancelled', remaining_quantity: '0' }),
  ]);
  assert.equal(orderRows(state)[0]?.status, 'open');
  state = applyOrders(state, [
    orderRecord('a', 7, { status: 'filled', remaining_quantity: '0' }),
  ]);
  assert.equal(orderRows(state)[0]?.status, 'filled');
  state = applyFills(state, [fillRecord('1', 'a'), fillRecord('2', 'a')]);
  assert.deepEqual(
    fillRows(state).map((row) => row.id),
    ['2:a', '1:a'],
  );
});

test('balances accept only replies at least as new as shown', () => {
  let state = install(base, []);
  const older = {
    commitId: 4,
    byAsset: new Map([
      ['EUR', { assetId: 'EUR', available: '1000', reserved: '0' }],
    ]),
  };
  state = applyBalances(state, older);
  assert.deepEqual(holding(state.balances, 'EUR'), {
    available: '800.000',
    reserved: '200.000',
    total: '1000.000',
  });
  const newer = { ...older, commitId: 6 };
  state = applyBalances(state, newer);
  assert.equal(holding(state.balances, 'EUR').available, '1000');
});

test('snapshot baselines decode from the object form', () => {
  assert.deepEqual(base.baselines, { orders: 3, fills: 1 });
  assert.equal(base.fillHighWatermark, 1);
});
