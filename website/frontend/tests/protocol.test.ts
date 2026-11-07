import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Assembler,
  ProcessChanged,
  StreamBroken,
} from '../src/live/protocol.ts';
import {
  bookSnapshot,
  fragments,
  frame,
  heartbeat,
  subscribed,
} from './frames.ts';

function feedAll(assembler: Assembler, frames: string[]) {
  return frames.flatMap((item) => assembler.feed(item));
}

test('snapshot then sequenced updates produce complete events in order', () => {
  const stream = new Assembler(['book', 'trades']);
  const events = feedAll(stream, [
    subscribed({ book: 4, trades: 2 }),
    ...bookSnapshot(4, [['99.00', '1']], [['101.00', '3']]),
    frame('book', 5, 'update', [
      { side: 'sell', price: '101.00', quantity: '0' },
    ]),
    frame('trades', 3, 'update', []),
    heartbeat({ book: 5, trades: 3 }),
  ]);
  assert.deepEqual(
    events.map((event) => event.kind),
    ['subscribed', 'snapshot', 'update', 'update', 'heartbeat'],
  );
});

test('fragmented bundles apply only once complete', () => {
  const stream = new Assembler(['trades']);
  stream.feed(subscribed({ trades: 0 }));
  const payload = Array.from({ length: 50 }, (_, index) => ({ index }));
  const parts = fragments('trades', 1, 'update', payload, 4);
  assert.deepEqual(stream.feed(parts[0] as string), []);
  assert.deepEqual(stream.feed(parts[1] as string), []);
  assert.deepEqual(stream.feed(parts[2] as string), []);
  const [event] = stream.feed(parts[3] as string);
  assert.equal(event?.kind, 'update');
  assert.deepEqual(event?.kind === 'update' && event.payload, payload);
});

test('an interrupted fragmented bundle breaks the stream', () => {
  const stream = new Assembler(['trades', 'book']);
  feedAll(stream, [
    subscribed({ trades: 0, book: 0 }),
    ...bookSnapshot(0, [], []),
  ]);
  const parts = fragments('trades', 1, 'update', [{ a: 1 }, { b: 2 }], 2);
  stream.feed(parts[0] as string);
  assert.throws(
    () =>
      stream.feed(
        frame('book', 1, 'update', [
          { side: 'buy', price: '1', quantity: '1' },
        ]),
      ),
    StreamBroken,
  );
});

test('sequence gaps, duplicates, and early updates break the stream', () => {
  const gap = new Assembler(['trades']);
  gap.feed(subscribed({ trades: 7 }));
  assert.throws(() => gap.feed(frame('trades', 9, 'update', [])), StreamBroken);

  const duplicate = new Assembler(['trades']);
  duplicate.feed(subscribed({ trades: 7 }));
  duplicate.feed(frame('trades', 8, 'update', []));
  assert.throws(
    () => duplicate.feed(frame('trades', 8, 'update', [])),
    StreamBroken,
  );

  const early = new Assembler(['book']);
  early.feed(subscribed({ book: 1 }));
  assert.throws(() => early.feed(frame('book', 2, 'update', [])), StreamBroken);

  const unconfirmed = new Assembler(['trades']);
  assert.throws(
    () => unconfirmed.feed(frame('trades', 1, 'update', [])),
    StreamBroken,
  );
});

test('a heartbeat ahead of applied sequences reveals a silent gap', () => {
  const stream = new Assembler(['orders', 'fills']);
  stream.feed(subscribed({ orders: 2, fills: 1 }));
  assert.throws(
    () => stream.feed(heartbeat({ orders: 3, fills: 1 })),
    StreamBroken,
  );
});

test('a different process identity is reported distinctly', () => {
  const stream = new Assembler(['trades'], 'process-1');
  assert.throws(
    () => stream.feed(subscribed({ trades: 0 }, { process: 'process-2' })),
    ProcessChanged,
  );
});

test('malformed frames break the stream', () => {
  const stream = new Assembler(['trades']);
  assert.throws(() => stream.feed('not json'), StreamBroken);
  assert.throws(() => stream.feed('{"channel":"control"}'), StreamBroken);
});
