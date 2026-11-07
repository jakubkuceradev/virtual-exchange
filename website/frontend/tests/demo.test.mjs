import assert from 'node:assert/strict';
import nodeTest from 'node:test';
import { createDemo as reference } from '../design/demo.js';
import { createDemo as frontend } from '../src/demo.ts';

for (const [label, createDemo] of [
  ['HTML reference', reference],
  ['React state', frontend],
]) {
  const test = (name, run) => nodeTest(`${label}: ${name}`, run);

  test('resting buy reserves cash without inventing a fill; cancellation releases it once', () => {
    const demo = createDemo();
    const before = demo.available();
    const fillCount = demo.state.fills.length;
    const result = demo.submit({
      side: 'buy',
      price: '110.00',
      quantity: '10',
    });
    assert.equal(result.order.status, 'Open');
    assert.equal(result.order.remaining, 10);
    assert.equal(demo.state.fills.length, fillCount);
    assert.equal(demo.available().cash, before.cash - 110000);
    assert.ok(demo.cancel(result.order.id).message);
    assert.deepEqual(demo.available(), before);
    assert.ok(demo.cancel(result.order.id).error);
    assert.deepEqual(demo.available(), before);
  });

  test('crossing buy executes at the ask, improves on the limit, and leaves a reserved remainder', () => {
    const demo = createDemo();
    const before = demo.available();
    const result = demo.submit({
      side: 'buy',
      price: '112.70',
      quantity: '10',
    });
    assert.equal(result.order.remaining, 4);
    assert.equal(result.order.status, 'Open');
    assert.equal(demo.state.fills[0].price, 11260);
    assert.equal(demo.state.fills[0].quantity, 6);
    assert.equal(demo.state.holdings, 486);
    assert.equal(demo.state.cash, 7645000 - 6 * 11260);
    assert.equal(demo.available().cash, before.cash - 6 * 11260 - 4 * 11270);
    assert.equal(demo.state.book.asks[0][0], 11280);
    demo.cancel(result.order.id);
    assert.equal(demo.available().cash, before.cash - 6 * 11260);
    assert.equal(demo.state.fills[0].quantity, 6);
  });

  test('complete fills cannot be cancelled and use only displayed liquidity', () => {
    const demo = createDemo();
    const result = demo.submit({
      side: 'buy',
      price: '113.00',
      quantity: '40',
    });
    assert.equal(result.order.status, 'Filled');
    assert.equal(result.order.remaining, 0);
    assert.deepEqual(
      demo.state.fills.slice(0, 3).map((fill) => [fill.price, fill.quantity]),
      [
        [11300, 10],
        [11280, 24],
        [11260, 6],
      ],
    );
    assert.equal(demo.state.book.asks[0][1], 32);
    const before = structuredClone(demo.state);
    assert.ok(demo.cancel(result.order.id).error);
    assert.deepEqual(demo.state, before);
  });

  test('resting and crossing sells reserve or settle holdings and preserve the price floor', () => {
    const demo = createDemo();
    const resting = demo.submit({
      side: 'sell',
      price: '115.00',
      quantity: '400',
    });
    assert.equal(demo.available().holdings, 80);
    const before = structuredClone(demo.state);
    assert.ok(
      demo.submit({ side: 'sell', price: '115.00', quantity: '81' }).error,
    );
    assert.deepEqual(demo.state, before);
    demo.cancel(resting.order.id);
    const crossing = demo.submit({
      side: 'sell',
      price: '112.30',
      quantity: '12',
    });
    assert.equal(crossing.order.remaining, 4);
    assert.equal(demo.state.fills[0].price, 11240);
    assert.equal(demo.state.holdings, 472);
    assert.equal(demo.available().holdings, 468);
    assert.equal(demo.state.cash, 7645000 + 8 * 11240);
    demo.cancel(crossing.order.id);
    assert.equal(demo.available().holdings, 472);
  });

  test('invalid input and insufficient funds do not mutate state', () => {
    const demo = createDemo();
    const before = structuredClone(demo.state);
    for (const input of [
      { side: 'market', price: '110', quantity: '1' },
      { side: 'buy', price: 'NaN', quantity: '1' },
      { side: 'buy', price: '0', quantity: '1' },
      { side: 'buy', price: '-1', quantity: '1' },
      { side: 'buy', price: '1.234', quantity: '1' },
      { side: 'buy', price: '1e2', quantity: '1' },
      { side: 'buy', price: '110', quantity: '1.5' },
      { side: 'buy', price: '110', quantity: '0' },
      { side: 'buy', price: '110', quantity: '-2' },
      { side: 'buy', price: '110', quantity: 'Infinity' },
      { side: 'buy', price: '110', quantity: '1000001' },
      { side: 'buy', price: '110', quantity: '1000' },
    ]) {
      assert.ok(demo.submit(input).error, JSON.stringify(input));
      assert.deepEqual(demo.state, before);
    }
  });

  test('multiple open orders cannot spend resources already reserved by another order', () => {
    const demo = createDemo();
    demo.submit({ side: 'buy', price: '100', quantity: '700' });
    assert.equal(demo.available().cash, 95000);
    const before = structuredClone(demo.state);
    assert.ok(demo.submit({ side: 'buy', price: '100', quantity: '10' }).error);
    assert.deepEqual(demo.state, before);
    assert.equal(
      demo.submit({ side: 'buy', price: '100', quantity: '9' }).order.remaining,
      9,
    );
    assert.equal(demo.available().cash, 5000);
  });

  test('exhausted sample liquidity produces an open order, not a fabricated execution', () => {
    const demo = createDemo();
    demo.state.book.asks = [];
    const count = demo.state.fills.length;
    const result = demo.submit({ side: 'buy', price: '120', quantity: '10' });
    assert.equal(result.order.remaining, 10);
    assert.equal(demo.state.fills.length, count);
    assert.ok(demo.cancel('missing').error);
  });

  test('credential lifecycle uses only dummy keys and requires revocation before recreation', () => {
    const demo = createDemo();
    const original = demo.state.credential;
    assert.ok(demo.createCredential().error);
    assert.equal(demo.state.credential, original);
    assert.ok(demo.revokeCredential().message);
    assert.equal(demo.state.credential, null);
    assert.ok(demo.revokeCredential().error);
    assert.ok(demo.createCredential().message);
    assert.match(demo.state.credential, /^pqc_demo_only_/);
    assert.notEqual(demo.state.credential, original);
  });
}

// React-only behavior added after the frozen HTML reference.
nodeTest(
  'React state: own open remainders appear in public depth and leave it on cancellation',
  () => {
    const demo = frontend();
    assert.deepEqual(demo.book().bids.at(-1), [11000, 50]);
    const result = demo.submit({ side: 'buy', price: '112.50', quantity: '5' });
    assert.deepEqual(demo.book().bids[0], [11250, 5]);
    assert.deepEqual(demo.state.book.bids[0], [11240, 8]);
    demo.cancel(result.order.id);
    assert.deepEqual(demo.book().bids[0], [11240, 8]);
  },
);

nodeTest(
  'React state: crossing an own order is prevented without a fill or price change',
  () => {
    const demo = frontend();
    const maker = demo.submit({
      side: 'buy',
      price: '112.50',
      quantity: '5',
    }).order;
    const fills = demo.state.fills.length;
    const holdings = demo.state.holdings;
    const result = demo.submit({
      side: 'sell',
      price: '112.45',
      quantity: '3',
    });
    assert.equal(result.order.status, 'Cancelled');
    assert.equal(result.order.remaining, 0);
    assert.match(result.message, /3 QC not executed/);
    assert.equal(maker.remaining, 2);
    assert.equal(maker.status, 'Open');
    assert.equal(demo.state.fills.length, fills);
    assert.equal(demo.state.holdings, holdings);
    assert.equal(demo.state.lastPrice, 11250);
    assert.deepEqual(demo.book().bids[0], [11250, 2]);
    assert.ok(demo.book().asks[0][0] > demo.book().bids[0][0]);
  },
);

nodeTest(
  'React state: external liquidity fills before own orders at a crossed level',
  () => {
    const demo = frontend();
    const maker = demo.submit({
      side: 'buy',
      price: '112.40',
      quantity: '4',
    }).order;
    const result = demo.submit({
      side: 'sell',
      price: '112.40',
      quantity: '10',
    });
    assert.equal(demo.state.fills[0].quantity, 8);
    assert.equal(maker.remaining, 2);
    assert.equal(maker.status, 'Open');
    assert.equal(result.order.status, 'Cancelled');
    assert.match(result.message, /8 QC filled.*2 QC not executed/);
    assert.equal(demo.state.lastPrice, 11240);
  },
);

nodeTest(
  'React state: executions update the last price; empty sessions have none',
  () => {
    const demo = frontend();
    assert.equal(demo.state.lastPrice, 11250);
    demo.submit({ side: 'buy', price: '112.70', quantity: '3' });
    assert.equal(demo.state.lastPrice, 11260);
    assert.equal(frontend(true).state.lastPrice, null);
  },
);
