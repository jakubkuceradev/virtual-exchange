import assert from 'node:assert/strict';
import test from 'node:test';
import { uuidV4 } from '../src/live/session.ts';
import { harness, instruments, page } from './fake.ts';
import { bookSnapshot, frame, orderRecord, subscribed } from './frames.ts';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function ready(permissions = ['read', 'trade']) {
  const h = harness();
  h.session.start();
  await h.reply('/instruments', instruments());
  const market = h.sockets[0];
  market?.open();
  market?.deliver(subscribed({ book: 0, trades: 0 }));
  market?.deliver(...bookSnapshot(0, [], []));
  await h.reply('/trades', page([]));
  void h.session.connect('alice-token');
  await h.reply('/identity', { account_id: 'alice', permissions });
  const socket = h.sockets[1];
  socket?.open();
  socket?.deliver(subscribed({ orders: 0, fills: 0 }));
  await h.reply('/account/snapshot', {
    process_id: 'process-1',
    commit_id: 0,
    balances: [
      { asset_id: 'EUR', available: '1000.000', reserved: '0.000' },
      { asset_id: 'QC', available: '0.0', reserved: '0.0' },
    ],
    orders: [],
    fill_high_watermark: 0,
    channel_baselines: { orders: 0, fills: 0 },
  });
  await h.reply('/fills', page([]));
  assert.equal(h.session.getView().account.status, 'ready');
  return { h, socket };
}

const balances = (commit: number) => ({
  process_id: 'process-1',
  commit_id: commit,
  data: [
    { asset_id: 'EUR', available: '800.000', reserved: '200.000' },
    { asset_id: 'QC', available: '0.0', reserved: '0.0' },
  ],
});

test('client UUIDs are canonical version 4', () => {
  assert.match(
    uuidV4((bytes) => bytes.fill(0xff)),
    UUID,
  );
  assert.match(
    uuidV4((bytes) => bytes.fill(0)),
    UUID,
  );
});

test('submit sends exact strings with one client UUID and reports acceptance only', async () => {
  const { h } = await ready();
  const result = h.session.submit({
    side: 'buy',
    price: '0100.00',
    quantity: '2',
  });
  await h.flush();
  assert.equal(h.session.getView().commands.busy, true);
  const [request] = h.requests;
  assert.equal(request?.path, '/orders');
  const post = await h.reply(
    '/orders',
    {
      order_id: 'aaaaaaaa-0000-4000-8000-000000000000',
      client_order_id: 'x',
      accepted_at: '2026-11-07T12:00:00+00:00',
      process_id: 'process-1',
    },
    201,
  );
  assert.equal(post.auth, 'Bearer alice-token');
  const outcome = await result;
  assert.equal(outcome.kind, 'accepted');
  assert.match(outcome.message, /accepted/);
  assert.equal(h.session.getView().commands.busy, false);
  // The order row is not synthesized from the receipt; balances are refreshed.
  const account = h.session.getView().account;
  assert.equal(account.status === 'ready' && account.orders.length, 0);
  await h.reply('/balances', balances(1));
});

test('submitted body is canonical and the UUID is retained', async () => {
  const { h } = await ready();
  void h.session.submit({ side: 'sell', price: '100.5', quantity: '0.3' });
  await h.flush();
  const body = h.requests.find((r) => r.path === '/orders')?.body as Record<
    string,
    string
  >;
  assert.equal(body.price, '100.5');
  assert.equal(body.quantity, '0.3');
  assert.equal(body.type, 'limit');
  assert.equal(body.instrument_id, 'QC-EUR');
  assert.match(body.client_order_id ?? '', UUID);
});

test('increments are validated before any request', async () => {
  const { h } = await ready();
  for (const [price, quantity, field] of [
    ['100.001', '1', 'price'],
    ['0', '1', 'price'],
    ['1e2', '1', 'price'],
    ['100', '0.25', 'quantity'],
    ['100', '-1', 'quantity'],
  ] as const) {
    const outcome = await h.session.submit({ side: 'buy', price, quantity });
    assert.equal(
      outcome.kind === 'rejected' && outcome.field,
      field,
      `${price} ${quantity}`,
    );
  }
  await h.flush();
  assert.equal(h.requests.length, 0);
});

test('insufficient funds is a definite rejection that refreshes balances', async () => {
  const { h } = await ready();
  const result = h.session.submit({
    side: 'buy',
    price: '100',
    quantity: '50',
  });
  await h.reply('/orders', { error: 'insufficient_funds' }, 409);
  const outcome = await result;
  assert.equal(outcome.kind, 'rejected');
  assert.equal(outcome.kind === 'rejected' && outcome.field, 'quantity');
  assert.equal(h.session.getView().commands.unresolved, null);
  await h.reply('/balances', balances(0));
});

test('a lost submit response is reconciled by client UUID and never resubmitted', async () => {
  const { h, socket } = await ready();
  const result = h.session.submit({ side: 'buy', price: '100', quantity: '2' });
  await h.flush();
  const posts = () => h.requests.filter((r) => r.path === '/orders').length;
  await h.fail('/orders');
  const outcome = await result;
  assert.equal(outcome.kind, 'unresolved');
  assert.match(
    h.session.getView().commands.unresolved ?? '',
    /not be sent again/,
  );
  // New submissions are blocked while unresolved.
  const blocked = await h.session.submit({
    side: 'buy',
    price: '100',
    quantity: '1',
  });
  assert.equal(blocked.kind, 'rejected');
  const lookup = h.requests.find((r) => r.path.startsWith('/orders/client:'));
  assert.ok(lookup, 'looks the order up by client ID');
  const clientId = lookup.path.slice('/orders/client:'.length);
  assert.match(clientId, UUID);
  await h.reply('/orders/client:', { error: 'order_not_found' }, 404);
  assert.notEqual(
    h.session.getView().commands.unresolved,
    null,
    '404 alone proves nothing',
  );
  // The order event arrives (it committed after all): resolved, one row.
  socket?.deliver(
    frame(
      'orders',
      1,
      'update',
      [orderRecord('o-1', 1, { client_order_id: clientId })],
      { commit: 1 },
    ),
  );
  const view = h.session.getView();
  assert.equal(view.commands.unresolved, null);
  assert.match(view.commands.feedback?.message ?? '', /received your order/);
  assert.equal(
    view.account.status === 'ready' && view.account.orders.length,
    1,
  );
  assert.equal(posts(), 0);
  await h.advance(60_000);
  assert.equal(h.requests.filter((r) => r.path === '/orders').length, 0);
});

test('an unresolved order can be dismissed only after a resync and lookup miss it', async () => {
  const { h } = await ready();
  const result = h.session.submit({ side: 'buy', price: '100', quantity: '2' });
  await h.flush();
  await h.fail('/orders');
  await result;
  await h.reply('/orders/client:', { error: 'order_not_found' }, 404);
  assert.equal(h.session.getView().commands.canDismiss, false);
  h.session.checkUnresolved();
  await h.reply('/identity', {
    account_id: 'alice',
    permissions: ['read', 'trade'],
  });
  const socket = h.sockets.at(-1);
  socket?.open();
  socket?.deliver(subscribed({ orders: 0, fills: 0 }));
  await h.reply('/account/snapshot', {
    process_id: 'process-1',
    commit_id: 0,
    balances: [],
    orders: [],
    fill_high_watermark: 0,
    channel_baselines: { orders: 0, fills: 0 },
  });
  await h.reply('/fills', page([]));
  await h.advance(1000);
  await h.reply('/orders/client:', { error: 'order_not_found' }, 404);
  assert.equal(h.session.getView().commands.canDismiss, true);
  h.session.dismissUnresolved();
  assert.equal(h.session.getView().commands.unresolved, null);
});

test('a cancel that loses the race shows the actual outcome', async () => {
  const { h } = await ready();
  const result = h.session.cancel('o-1');
  await h.reply('/orders/o-1', { error: 'order_finished' }, 409);
  await h.reply('/orders/o-1', {
    process_id: 'process-1',
    data: orderRecord('o-1', 3, { status: 'filled', remaining_quantity: '0' }),
  });
  const outcome = await result;
  assert.equal(outcome.kind, 'info');
  assert.match(
    outcome.message,
    /is filled; it finished before the cancellation/,
  );
  const view = h.session.getView().account;
  assert.equal(view.status === 'ready' && view.orders[0]?.status, 'filled');
});

test('replies for a previous account are ignored', async () => {
  const { h } = await ready();
  const result = h.session.submit({ side: 'buy', price: '100', quantity: '2' });
  await h.flush();
  void h.session.connect('bob-token');
  await h.reply(
    '/orders',
    {
      order_id: 'x',
      client_order_id: null,
      accepted_at: '2026-11-07T12:00:00Z',
      process_id: 'process-1',
    },
    201,
  );
  const outcome = await result;
  assert.equal(outcome.kind, 'info');
  assert.equal(h.session.getView().commands.feedback, null);
});

test('read-only tokens cannot send commands', async () => {
  const { h } = await ready(['read']);
  const outcome = await h.session.submit({
    side: 'buy',
    price: '100',
    quantity: '1',
  });
  assert.equal(outcome.kind, 'rejected');
  const cancel = await h.session.cancel('o-1');
  assert.equal(cancel.kind, 'rejected');
  await h.flush();
  assert.equal(h.requests.length, 0);
});
