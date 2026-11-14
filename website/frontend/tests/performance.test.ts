/**
 * Regression guard for per-update cost: a session holding a full price window
 * and a busy account must absorb a burst of live traffic without rescanning
 * history. Publishing is synchronous here (every change composes a view), the
 * worst case; browsers coalesce to one publish per frame.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { harness, instruments, page } from './fake.ts';
import {
  bookSnapshot,
  fillRecord,
  frame,
  orderRecord,
  subscribed,
  tradeRecord,
} from './frames.ts';

const recorded: Record<string, string>[] = JSON.parse(
  readFileSync(new URL('./data/trades.json', import.meta.url), 'utf8'),
);
/** Generous: the bounded implementation needs a small fraction of this. */
const BUDGET_MS = 750;

test('a burst of book and trade updates stays within budget', async () => {
  const h = harness();
  h.session.start();
  await h.reply('/instruments', instruments());
  const market = h.sockets[0];
  market?.open();
  market?.deliver(subscribed({ book: 0, trades: 0 }));
  market?.deliver(
    ...bookSnapshot(
      0,
      Array.from({ length: 20 }, (_, i) => [`${99 - i * 0.01}`, '5']),
      Array.from({ length: 20 }, (_, i) => [`${101 + i * 0.01}`, '5']),
    ),
  );
  await h.reply('/trades', page(recorded));

  void h.session.connect('alice-token');
  await h.reply('/identity', { account_id: 'alice', permissions: ['read'] });
  const account = h.sockets.at(-1);
  account?.open();
  account?.deliver(subscribed({ orders: 0, fills: 0 }));
  const orders = Array.from({ length: 10_000 }, (_, index) =>
    orderRecord(`order-${index}`, 1, {
      status: index % 10 ? 'cancelled' : 'open',
      remaining_quantity: index % 10 ? '0' : '1',
    }),
  );
  await h.reply('/account/snapshot', {
    process_id: 'process-1',
    commit_id: 1,
    balances: [{ asset_id: 'EUR', available: '1000', reserved: '0' }],
    orders,
    fill_high_watermark: 2000,
    channel_baselines: { orders: 0, fills: 0 },
  });
  await h.reply(
    '/fills',
    page(Array.from({ length: 2000 }, (_, i) => fillRecord(String(i), 'x'))),
  );
  assert.equal(h.session.getView().account.status, 'ready');

  const newest = Number(recorded[0]?.trade_id);
  const at = recorded[0]?.executed_at;
  const started = performance.now();
  let trades = 0;
  for (let sequence = 1; sequence <= 1000; sequence++) {
    market?.deliver(
      frame('book', sequence, 'update', [
        { side: 'buy', price: '99', quantity: String(sequence) },
      ]),
    );
    if (sequence % 10 === 0) {
      trades++;
      market?.deliver(
        frame('trades', trades, 'update', [
          tradeRecord(String(newest + trades), '100.00', '1', at),
        ]),
      );
    }
  }
  const elapsed = performance.now() - started;
  const view = h.session.getView();
  assert.equal(view.market.book?.bids[0]?.quantity, '1000');
  assert.equal(view.market.lastPrice, '100.00');
  assert.ok(
    elapsed < BUDGET_MS,
    `1,000 book updates and 100 trades took ${elapsed.toFixed(0)} ms`,
  );
  console.log(`burst: ${elapsed.toFixed(1)} ms`);
});
