import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyBalances,
  applyFills,
  applyOrders,
  CLOSED_ORDER_LIMIT,
  FILL_LIMIT,
  fillRows,
  holding,
  install,
  orderRows,
  snapshot,
} from '../src/live/account.ts';
import { fillRecord, orderRecord } from './frames.ts';

const rawBase = {
  process_id: 'process-1',
  commit_id: 5,
  balances: [
    { asset_id: 'EUR', available: '800.000', reserved: '200.000' },
    { asset_id: 'QC', available: '2.0', reserved: '0.0' },
  ],
  orders: [orderRecord('a', 5)],
  fill_high_watermark: 1,
  channel_baselines: { orders: 3, fills: 1 },
};
const base = snapshot(rawBase);

test('order versions never regress and fills deduplicate', () => {
  let state = applyFills(install(base), [fillRecord('1', 'a')]);
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
  let state = install(base);
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

const at = (n: number) =>
  new Date(Date.UTC(2026, 10, 7, 12, 0, n)).toISOString();

test('retention keeps every resting order and the most recent closed ones', () => {
  const orders = [
    orderRecord('resting-old', 1, { accepted_at: at(0) }),
    ...Array.from({ length: CLOSED_ORDER_LIMIT + 30 }, (_, index) =>
      orderRecord(`closed-${index}`, 1, {
        status: 'cancelled',
        remaining_quantity: '0',
        accepted_at: at(index + 1),
      }),
    ),
  ];
  let state = install(snapshot({ ...rawBase, orders }));
  const rows = orderRows(state);
  assert.equal(rows.length, CLOSED_ORDER_LIMIT + 1);
  assert.ok(rows.some((row) => row.id === 'resting-old'));
  assert.equal(rows[0]?.id, `closed-${CLOSED_ORDER_LIMIT + 29}`);
  assert.ok(!rows.some((row) => row.id === 'closed-0'));
  // A new closed order pushes out the oldest retained one.
  state = applyOrders(state, [
    orderRecord('closed-new', 1, {
      status: 'filled',
      remaining_quantity: '0',
      accepted_at: at(500),
    }),
  ]);
  assert.equal(orderRows(state).length, CLOSED_ORDER_LIMIT + 1);
  assert.equal(orderRows(state)[0]?.id, 'closed-new');
  assert.ok(!orderRows(state).some((row) => row.id === 'closed-30'));
});

test('retention keeps the most recent fills', () => {
  const fills = Array.from({ length: FILL_LIMIT + 20 }, (_, index) =>
    fillRecord(String(index + 1), 'a'),
  );
  const state = applyFills(install(base), fills);
  const rows = fillRows(state);
  assert.equal(rows.length, FILL_LIMIT);
  assert.equal(rows[0]?.id, `${FILL_LIMIT + 20}:a`);
  assert.equal(rows.at(-1)?.id, '21:a');
});
