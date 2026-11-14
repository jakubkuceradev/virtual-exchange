import assert from 'node:assert/strict';
import test from 'node:test';
import { prepend, recover } from '../src/live/news.ts';
import { HEARTBEAT_DEADLINE_MS } from '../src/live/session.ts';
import { badge, countdown, unread } from '../src/news-format.ts';
import { harness, instruments, page } from './fake.ts';
import { bookSnapshot, frame, subscribed } from './frames.ts';

const item = (id: string, extra: Record<string, unknown> = {}) => ({
  news_id: id,
  headline: `Headline ${id}`,
  body: null,
  instrument_ids: ['QC-EUR'],
  event_at: null,
  published_at: '2026-11-10T12:00:00+00:00',
  ...extra,
});
const ids = (items: readonly { id: string }[]) => items.map((x) => x.id);

test('recovery installs the page at the baseline, then newer buffered items', () => {
  const feed = recover([item('b'), item('a')], 2, [
    { sequence: 2, payload: [item('b')] },
    { sequence: 3, payload: [item('c')] },
    { sequence: 4, payload: [item('d')] },
  ]);
  assert.deepEqual(ids(feed), ['d', 'c', 'b', 'a']);
  assert.deepEqual(ids(prepend(feed, [item('c'), item('e')])), [
    'e',
    'd',
    'c',
    'b',
    'a',
  ]);
});

test('news items decode times, tags and optional fields', () => {
  const [decoded] = prepend(
    [],
    [item('x', { body: 'Body', event_at: '2026-11-10T13:00:00Z' })],
  );
  assert.equal(decoded?.body, 'Body');
  assert.equal(decoded?.eventAt, Date.parse('2026-11-10T13:00:00Z'));
  assert.deepEqual(decoded?.instrumentIds, ['QC-EUR']);
  assert.throws(() => prepend([], [{ news_id: 'y' }]));
});

test('countdown, unread count and badge formatting', () => {
  assert.equal(countdown(65_000, 0), 'in 01:05');
  assert.equal(countdown(3_661_000, 0), 'in 01:01:01');
  assert.equal(countdown(2 * 86_400_000 + 5_000, 0), 'in 2d 00:00:05');
  assert.equal(countdown(1_000, 1_000), null);
  assert.equal(unread([{ id: 'a' }, { id: 'b' }], new Set(['a'])), 1);
  assert.equal(badge(0), null);
  assert.equal(badge(7), '7');
  assert.equal(badge(120), '99+');
});

async function newsReady(h: ReturnType<typeof harness>, baseline = 1) {
  const socket = h.newsSockets.at(-1);
  assert.ok(socket);
  socket.open();
  assert.deepEqual(socket.sent, [{ type: 'subscribe', channels: ['news'] }]);
  socket.deliver(subscribed({ news: baseline }));
  // A bundle published while the page is in flight is buffered, not lost.
  socket.deliver(frame('news', baseline + 1, 'update', [item('new')]));
  assert.equal(h.session.getView().news.status, 'connecting');
  const request = await h.reply('/news', page([item('old')]));
  assert.match(request.path, new RegExp(`high_watermark=${baseline}`));
  assert.equal(request.auth, null);
  return socket;
}

test('the news channel recovers through the list and prepends live items', async () => {
  const h = harness();
  h.session.start();
  const socket = await newsReady(h);
  socket.deliver(frame('news', 3, 'update', [item('newest')]));
  const { news } = h.session.getView();
  assert.equal(news.status, 'ready');
  assert.deepEqual(ids(news.items), ['newest', 'new', 'old']);
});

test('a news gap resubscribes the feed without touching the market', async () => {
  const h = harness();
  h.session.start();
  await h.reply('/instruments', instruments());
  const market = h.sockets.at(-1);
  market?.open();
  market?.deliver(subscribed({ book: 0, trades: 0 }));
  market?.deliver(...bookSnapshot(0, [], []));
  await h.reply('/trades', page([]));
  const socket = await newsReady(h);
  socket.deliver(frame('news', 9, 'update', [item('skipped')]));
  assert.equal(socket.closed, true);
  const view = h.session.getView();
  assert.equal(view.news.status, 'stale');
  assert.deepEqual(ids(view.news.items), ['new', 'old']);
  assert.equal(view.market.status, 'ready');
  assert.equal(market?.closed, false);
  await h.advance(1000);
  const next = h.newsSockets.at(-1);
  assert.notEqual(next, socket);
  next?.open();
  next?.deliver(subscribed({ news: 3 }));
  await h.reply('/news', page([item('c'), item('new'), item('old')]));
  assert.equal(h.session.getView().news.status, 'ready');
  assert.deepEqual(ids(h.session.getView().news.items), ['c', 'new', 'old']);
});

test('a missed news heartbeat marks the feed stale', async () => {
  const h = harness();
  h.session.start();
  const socket = await newsReady(h);
  await h.advance(HEARTBEAT_DEADLINE_MS + 1);
  assert.equal(socket.closed, true);
  assert.equal(h.session.getView().news.status, 'stale');
});

test('an exchange restart seen on the news channel clears the feed', async () => {
  const h = harness();
  h.session.start();
  const socket = await newsReady(h);
  socket.deliver(frame('news', 3, 'update', [], { process: 'process-2' }));
  const view = h.session.getView();
  assert.deepEqual(view.news.items, []);
  assert.equal(view.news.status, 'connecting');
  assert.match(view.notice ?? '', /restarted/);
  assert.equal(h.newsSockets.length, 2);
});
