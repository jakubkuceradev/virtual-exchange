import assert from 'node:assert/strict';
import test from 'node:test';
import { HEARTBEAT_DEADLINE_MS } from '../src/live/session.ts';
import { harness, instruments, page } from './fake.ts';
import {
  bookSnapshot,
  fillRecord,
  frame,
  orderRecord,
  subscribed,
  tradeRecord,
} from './frames.ts';

async function publicReady(h: ReturnType<typeof harness>) {
  h.session.start();
  await h.reply('/instruments', instruments());
  const socket = h.sockets.at(-1);
  assert.ok(socket);
  socket.open();
  assert.deepEqual(socket.sent, [
    { type: 'subscribe', channels: ['book', 'trades'] },
  ]);
  socket.deliver(subscribed({ book: 0, trades: 0 }));
  socket.deliver(...bookSnapshot(0, [['99.00', '1']], [['101.00', '2']]));
  await h.reply('/trades', page([]));
  assert.equal(h.session.getView().market.status, 'ready');
  return socket;
}

const snapshotBody = (commit: number, orders: unknown[], watermark = 0) => ({
  process_id: 'process-1',
  commit_id: commit,
  balances: [
    { asset_id: 'EUR', available: '800.000', reserved: '200.000' },
    { asset_id: 'QC', available: '0.0', reserved: '0.0' },
  ],
  orders,
  fill_high_watermark: watermark,
  channel_baselines: { orders: 0, fills: 0 },
});

async function connected(
  h: ReturnType<typeof harness>,
  permissions = ['read', 'trade'],
) {
  void h.session.connect('alice-token');
  const identity = await h.reply('/identity', {
    account_id: 'alice',
    permissions,
  });
  assert.equal(identity.auth, 'Bearer alice-token');
  return h.sockets.at(-1);
}

test('trades buffered during REST recovery merge without duplicates', async () => {
  const h = harness();
  h.session.start();
  await h.reply('/instruments', instruments());
  const socket = h.sockets[0];
  assert.ok(socket);
  socket.open();
  socket.deliver(subscribed({ book: 0, trades: 4 }));
  socket.deliver(...bookSnapshot(0, [], []));
  // An event arrives before the REST history reply and overlaps it.
  socket.deliver(
    frame('trades', 5, 'update', [tradeRecord('5', '102.00', '1')]),
  );
  assert.equal(h.session.getView().market.status, 'connecting');
  await h.reply(
    '/trades',
    page([tradeRecord('5', '102.00', '1'), tradeRecord('4', '100.00', '2')]),
  );
  const { market } = h.session.getView();
  assert.equal(market.status, 'ready');
  assert.equal(market.lastPrice, '102.00');
  assert.equal(market.stats?.volume, '3');
});

test('a sequence gap marks the market stale and resubscribes after backoff', async () => {
  const h = harness();
  const socket = await publicReady(h);
  socket.deliver(frame('book', 2, 'update', []));
  assert.equal(socket.closed, true);
  assert.equal(h.session.getView().market.status, 'stale');
  assert.match(h.session.getView().notice ?? '', /Reconnecting/);
  await h.advance(1000);
  const next = h.sockets.at(-1);
  assert.notEqual(next, socket);
  next?.open();
  next?.deliver(subscribed({ book: 3, trades: 0 }));
  next?.deliver(...bookSnapshot(3, [], [['105.00', '1']]));
  await h.reply('/trades', page([]));
  assert.equal(h.session.getView().market.status, 'ready');
  assert.equal(h.session.getView().market.book?.asks[0]?.price, '105');
});

test('a missed heartbeat deadline resynchronizes', async () => {
  const h = harness();
  const socket = await publicReady(h);
  await h.advance(HEARTBEAT_DEADLINE_MS + 1);
  assert.equal(socket.closed, true);
  assert.equal(h.session.getView().market.status, 'stale');
});

test('a new process identity clears all state and explains the reset', async () => {
  const h = harness();
  const socket = await publicReady(h);
  socket.deliver(
    frame('trades', 1, 'update', [tradeRecord('1', '100.00', '1')]),
  );
  assert.equal(h.session.getView().market.lastPrice, '100.00');
  socket.deliver(frame('trades', 2, 'update', [], { process: 'process-2' }));
  const view = h.session.getView();
  assert.equal(view.market.lastPrice, null);
  assert.equal(view.market.book, null);
  assert.match(view.notice ?? '', /restarted/);
  await h.reply('/instruments', instruments('process-2'));
  assert.equal(h.sockets.length, 2);
});

test('private recovery keeps newer buffered order versions and deduplicates fills', async () => {
  const h = harness();
  await publicReady(h);
  const socket = await connected(h);
  assert.ok(socket);
  socket.open();
  assert.deepEqual(socket.sent, [
    { type: 'subscribe', channels: ['orders', 'fills'], token: 'alice-token' },
  ]);
  socket.deliver(subscribed({ orders: 0, fills: 0 }));
  // Early events: a newer version of order A and a fill also in REST history.
  socket.deliver(
    frame(
      'orders',
      1,
      'update',
      [
        orderRecord('a', 6, {
          status: 'partially_filled',
          remaining_quantity: '1',
        }),
      ],
      { commit: 6 },
    ),
    frame('fills', 1, 'update', [fillRecord('1', 'a', { quantity: '1' })], {
      commit: 6,
    }),
  );
  assert.equal(h.session.getView().account.status, 'connecting');
  await h.reply('/account/snapshot', snapshotBody(5, [orderRecord('a', 5)], 1));
  const fills = await h.reply(
    '/fills',
    page([fillRecord('1', 'a', { quantity: '1' })]),
  );
  assert.match(fills.path, /high_watermark=1/);
  const { account } = h.session.getView();
  assert.equal(account.status, 'ready');
  if (account.status !== 'ready') return;
  assert.equal(account.orders[0]?.status, 'partially_filled');
  assert.equal(account.fills.length, 1);
  // Buffered events were newer than the snapshot: balances are refreshed.
  await h.reply('/balances', {
    process_id: 'process-1',
    commit_id: 6,
    data: [
      { asset_id: 'EUR', available: '800.000', reserved: '100.000' },
      { asset_id: 'QC', available: '1.0', reserved: '0.0' },
    ],
  });
  const after = h.session.getView().account;
  assert.equal(after.status === 'ready' && after.asset.available, '1.0');
});

test('older balance replies never replace newer ones', async () => {
  const h = harness();
  await publicReady(h);
  const socket = await connected(h);
  socket?.open();
  socket?.deliver(subscribed({ orders: 0, fills: 0 }));
  await h.reply('/account/snapshot', snapshotBody(9, []));
  await h.reply('/fills', page([]));
  socket?.deliver(
    frame('orders', 1, 'update', [orderRecord('a', 10)], { commit: 10 }),
  );
  socket?.deliver(
    frame('orders', 2, 'update', [orderRecord('a', 11)], { commit: 11 }),
  );
  await h.reply('/balances', {
    process_id: 'process-1',
    commit_id: 8,
    data: [{ asset_id: 'EUR', available: '1000', reserved: '0' }],
  });
  const view = h.session.getView().account;
  assert.equal(view.status === 'ready' && view.cash.available, '800.000');
  // The coalesced second refresh follows.
  await h.reply('/balances', {
    process_id: 'process-1',
    commit_id: 11,
    data: [{ asset_id: 'EUR', available: '700', reserved: '300' }],
  });
  const latest = h.session.getView().account;
  assert.equal(latest.status === 'ready' && latest.cash.available, '700');
});

test('refused credentials stop instead of reconnecting', async () => {
  for (const [code, reason, status] of [
    [4401, 'invalid_token', 'rejected'],
    [4403, 'account_not_provisioned', 'not-provisioned'],
    [4403, 'insufficient_scope', 'no-read'],
  ] as const) {
    const h = harness();
    await publicReady(h);
    const socket = await connected(h);
    socket?.open();
    const timers = h.pendingTimers();
    socket?.drop(code, reason);
    assert.equal(h.session.getView().account.status, status);
    assert.equal(h.sockets.length, 2);
    await h.advance(60_000);
    assert.equal(h.sockets.length, 2, `${status} must not reconnect`);
    assert.ok(h.pendingTimers() <= timers);
  }
});

test('invalid and read-less tokens never open a private subscription', async () => {
  const h = harness();
  await publicReady(h);
  void h.session.connect('bad');
  await h.reply('/identity', { error: 'invalid_token' }, 401);
  assert.equal(h.session.getView().account.status, 'rejected');
  assert.equal(h.session.getView().identity, null);
  await connected(h, ['trade']);
  assert.equal(h.session.getView().account.status, 'no-read');
  assert.equal(h.sockets.length, 1);
});

test('switching tokens ignores late replies from the previous connection', async () => {
  const h = harness();
  await publicReady(h);
  void h.session.connect('alice-token');
  await h.flush();
  void h.session.connect('bob-token');
  await h.flush();
  // Bob's identity answers first; Alice's late reply must be ignored.
  const bobRequest = h.requests.findIndex((r) => r.auth === 'Bearer bob-token');
  const [bob] = h.requests.splice(bobRequest, 1);
  bob?.resolve({
    status: 200,
    body: { account_id: 'bob', permissions: ['read'] },
  });
  await h.reply('/identity', {
    account_id: 'alice',
    permissions: ['read', 'trade'],
  });
  const view = h.session.getView();
  assert.equal(view.identity?.accountId, 'bob');
  assert.deepEqual(view.identity?.permissions, ['read']);
});

test('disconnect clears private state and closes the private socket', async () => {
  const h = harness();
  await publicReady(h);
  const socket = await connected(h);
  socket?.open();
  socket?.deliver(subscribed({ orders: 0, fills: 0 }));
  await h.reply('/account/snapshot', snapshotBody(1, [orderRecord('a', 1)]));
  await h.reply('/fills', page([]));
  h.session.disconnect();
  assert.equal(socket?.closed, true);
  const view = h.session.getView();
  assert.equal(view.account.status, 'signed-out');
  assert.equal(view.identity, null);
  socket?.deliver(frame('orders', 1, 'update', [orderRecord('b', 2)]));
  assert.equal(h.session.getView().account.status, 'signed-out');
});

test('an unreachable exchange is reported, never replaced with fixtures', async () => {
  const h = harness();
  h.session.start();
  await h.fail('/instruments');
  const view = h.session.getView();
  assert.equal(view.market.status, 'unavailable');
  assert.equal(view.market.book, null);
  assert.match(view.notice ?? '', /unreachable/);
  await h.advance(1000);
  await h.reply('/instruments', instruments());
  assert.equal(h.sockets.length, 1);
});
