import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRIDGE_PAGE_LIMIT,
  HEARTBEAT_DEADLINE_MS,
} from '../src/live/session.ts';
import { candleRecord, candles, harness, instruments, page } from './fake.ts';
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
  await h.reply('/candles', candles());
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

test('the candle snapshot, bridge, and buffered trades count each execution once', async () => {
  const h = harness();
  h.session.start();
  await h.reply('/instruments', instruments());
  const socket = h.sockets[0];
  assert.ok(socket);
  socket.open();
  socket.deliver(subscribed({ book: 0, trades: 4 }));
  socket.deliver(...bookSnapshot(0, [], []));
  // A live event arrives before the history replies and overlaps the bridge.
  socket.deliver(
    frame('trades', 5, 'update', [tradeRecord('5', '102.00', '1')]),
  );
  // The book alone makes the market tradable; history loads separately.
  assert.equal(h.session.getView().market.status, 'ready');
  assert.equal(h.session.getView().market.historyStatus, 'loading');
  await h.reply(
    '/candles',
    candles(
      [
        candleRecord(
          '2026-11-07T12:00:00+00:00',
          '100.00',
          '100.00',
          '100.00',
          '100.00',
          '2',
        ),
      ],
      '4',
    ),
  );
  const bridge = await h.reply(
    '/trades',
    page([tradeRecord('5', '102.00', '1'), tradeRecord('4', '100.00', '2')]),
  );
  assert.match(bridge.path, /limit=200/);
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
  await h.reply('/candles', candles());
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
  // The socket opens with the instrument request: one per attempt, never more.
  assert.equal(h.sockets.length, 2);
  assert.equal(h.sockets[0]?.closed, true);
});

test('a slow-client close (1013) is transient and resubscribes', async () => {
  const h = harness();
  const socket = await publicReady(h);
  socket.drop(1013, '');
  assert.equal(h.session.getView().market.status, 'stale');
  await h.advance(1000);
  assert.equal(h.sockets.length, 2);
});

test('backoff grows but stays bounded while the exchange is down', async () => {
  const h = harness();
  h.session.start();
  let elapsed = 0;
  for (let attempt = 0; attempt < 12; attempt++) {
    await h.fail('/instruments');
    // Advance in 1 s steps until the next attempt is issued; it must come
    // within the 15 s cap.
    let waited = 0;
    while (!h.requests.some((r) => r.path === '/instruments')) {
      await h.advance(1000);
      waited += 1000;
      assert.ok(waited <= 15_000, `attempt ${attempt} waited ${waited} ms`);
    }
    elapsed += waited;
  }
  assert.ok(elapsed > 60_000, 'later attempts back off');
});

test('stopping (unmount) closes both sockets and leaves no timers', async () => {
  const h = harness();
  const market = await publicReady(h);
  void h.session.connect('alice-token');
  await h.reply('/identity', { account_id: 'alice', permissions: ['read'] });
  const account = h.sockets.at(-1);
  account?.open();
  h.session.stop();
  assert.equal(market.closed, true);
  assert.equal(account?.closed, true);
  assert.equal(h.pendingTimers(), 0);
  market.deliver(frame('book', 1, 'update', []));
  await h.advance(60_000);
  assert.equal(h.sockets.length, 2);
});

const minute = (n: number) =>
  `2026-11-07T${String(12 + Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}:00+00:00`;
const cursorPage = (data: unknown[], next: string | null) => ({
  ...page(data),
  next_cursor: next,
});
const bar = (n: number, close: string, volume = '1') =>
  candleRecord(minute(n), close, close, close, close, volume);

async function subscribedMarket(h: ReturnType<typeof harness>) {
  h.session.start();
  await h.reply('/instruments', instruments());
  const socket = h.sockets[0];
  assert.ok(socket);
  socket.open();
  socket.deliver(subscribed({ book: 0, trades: 0 }));
  socket.deliver(...bookSnapshot(0, [['99.00', '1']], [['101.00', '2']]));
  return socket;
}

test('instrument, candles, and the subscription start together', async () => {
  const h = harness();
  h.session.start();
  await h.flush();
  assert.deepEqual(h.requests.map((request) => request.path).sort(), [
    '/candles',
    '/instruments',
  ]);
  assert.equal(h.sockets.length, 1);
});

test('the chart appears from candles before the subscription is confirmed', async () => {
  const h = harness();
  h.session.start();
  await h.reply(
    '/candles',
    candles([bar(10, '100.00'), bar(11, '101.00')], '9'),
  );
  const { market } = h.session.getView();
  assert.equal(market.historyStatus, 'ready');
  assert.deepEqual(
    market.chart.candles.map((candle) => candle.close),
    ['100.00', '101.00'],
  );
  assert.equal(market.lastPrice, '101.00');
  assert.equal(market.statsLabel, '1H');
  // No trade request is made until the subscription can buffer live trades.
  assert.ok(!h.requests.some((request) => request.path.startsWith('/trades')));
});

test('trading is available while price history keeps failing', async () => {
  const h = harness();
  await subscribedMarket(h);
  await h.fail('/candles');
  const { market } = h.session.getView();
  assert.equal(market.status, 'ready');
  assert.equal(market.historyStatus, 'unavailable');
  assert.equal(h.session.getView().notice, null);
  await h.advance(1000);
  await h.reply('/candles', candles([bar(5, '100.00')], '1'));
  await h.reply('/trades', page([]));
  assert.equal(h.session.getView().market.historyStatus, 'ready');
});

test('a failed bridge page is retried alone', async () => {
  const h = harness();
  await subscribedMarket(h);
  await h.reply('/candles', candles([bar(30, '100.00')], '10'));
  await h.reply(
    '/trades',
    cursorPage([tradeRecord('12', '103.00', '1', minute(31))], 'c1'),
  );
  await h.fail('/trades');
  await h.advance(1000);
  const retry = await h.reply(
    '/trades',
    cursorPage([tradeRecord('11', '102.00', '1', minute(31))], 'c2'),
  );
  assert.match(retry.path, /cursor=c1/);
  // Trade 11 was the oldest after the snapshot; 10 would be next: still
  // unreached, so paging continues until a known trade appears.
  await h.reply(
    '/trades',
    cursorPage([tradeRecord('10', '100.00', '1', minute(30))], 'c3'),
  );
  const { market } = h.session.getView();
  assert.equal(market.historyStatus, 'ready');
  assert.deepEqual(
    market.chart.candles.map((candle) => candle.close),
    ['100.00', '103.00'],
  );
  assert.equal(market.stats?.volume, '3');
});

test('too many trades between snapshot and subscription reload the snapshot', async () => {
  const h = harness();
  await subscribedMarket(h);
  await h.reply('/candles', candles([bar(30, '100.00')], '1'));
  for (let index = 0; index < BRIDGE_PAGE_LIMIT; index++)
    await h.reply(
      '/trades',
      cursorPage(
        [tradeRecord(String(1000 - index), '105.00', '1', minute(40))],
        `c${index}`,
      ),
    );
  // The bridge gives up; a snapshot taken while subscribed has no gap.
  await h.reply('/candles', candles([bar(40, '105.00', '7')], '1000'));
  const { market } = h.session.getView();
  assert.equal(market.historyStatus, 'ready');
  assert.equal(market.stats?.volume, '7');
  assert.equal(
    h.requests.filter((request) => request.path.startsWith('/trades')).length,
    0,
  );
});

test('a resubscribe reloads candles and bridges again', async () => {
  const h = harness();
  const socket = await subscribedMarket(h);
  await h.reply('/candles', candles([bar(30, '100.00')], '5'));
  await h.reply('/trades', page([]));
  socket.drop();
  assert.equal(h.session.getView().market.historyStatus, 'stale');
  await h.advance(1000);
  const next = h.sockets.at(-1);
  next?.open();
  next?.deliver(subscribed({ book: 0, trades: 0 }));
  next?.deliver(...bookSnapshot(0, [], []));
  await h.reply(
    '/candles',
    candles([bar(30, '100.00'), bar(31, '104.00')], '7'),
  );
  await h.reply('/trades', page([tradeRecord('7', '104.00', '1', minute(31))]));
  const { market } = h.session.getView();
  assert.equal(market.historyStatus, 'ready');
  assert.equal(market.lastPrice, '104.00');
  assert.equal(market.stats?.volume, '2');
});

test('changes between frames publish one view, and unchanged slices keep identity', async () => {
  const h = harness({ frames: 'manual' });
  h.session.start();
  await h.reply('/instruments', instruments());
  const socket = h.sockets[0];
  socket?.open();
  socket?.deliver(subscribed({ book: 0, trades: 0 }));
  socket?.deliver(...bookSnapshot(0, [['99.00', '1']], [['101.00', '2']]));
  await h.reply('/candles', candles([bar(0, '100.00')], '1'));
  await h.reply('/trades', page([]));
  h.frame();
  const before = h.session.getView();
  let published = 0;
  h.session.subscribe(() => published++);
  for (let sequence = 1; sequence <= 50; sequence++)
    socket?.deliver(
      frame('book', sequence, 'update', [
        { side: 'buy', price: '99.00', quantity: String(sequence) },
      ]),
    );
  // Nothing is published until the frame runs, then exactly once.
  assert.equal(h.session.getView(), before);
  h.frame();
  assert.equal(published, 1);
  const after = h.session.getView();
  assert.equal(after.market.book?.bids[0]?.quantity, '50');
  // Book-only changes leave the chart, statistics, account, and news untouched.
  assert.equal(after.market.chart, before.market.chart);
  assert.equal(after.market.stats, before.market.stats);
  assert.equal(after.market.instrument, before.market.instrument);
  assert.equal(after.account, before.account);
  assert.equal(after.news, before.news);
  // A frame without changes publishes nothing.
  h.frame();
  assert.equal(published, 1);
});

test('the account is ready before fill history, which retries without blocking trading', async () => {
  const h = harness();
  await publicReady(h);
  const socket = await connected(h);
  socket?.open();
  socket?.deliver(subscribed({ orders: 0, fills: 0 }));
  await h.reply('/account/snapshot', snapshotBody(5, [orderRecord('a', 5)], 2));
  let { account } = h.session.getView();
  assert.equal(account.status, 'ready');
  if (account.status !== 'ready') return;
  assert.equal(account.canTrade, true);
  assert.equal(account.fillsReady, false);
  await h.fail('/fills');
  assert.equal(h.session.getView().account.status, 'ready');
  // A live fill during the retry is kept and merged with the history.
  socket?.deliver(
    frame('fills', 1, 'update', [fillRecord('3', 'a')], { commit: 7 }),
  );
  await h.advance(1000);
  await h.reply('/fills', page([fillRecord('2', 'a'), fillRecord('1', 'a')]));
  account = h.session.getView().account;
  assert.equal(account.status, 'ready');
  if (account.status !== 'ready') return;
  assert.equal(account.fillsReady, true);
  assert.deepEqual(
    account.fills.map((row) => row.id),
    ['3:a', '2:a', '1:a'],
  );
});
