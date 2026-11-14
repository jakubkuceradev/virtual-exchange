import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CompetitionFeed,
  POLL_MS,
  STALE_MS,
  thin,
} from '../src/live/competition.ts';

const NOW = Date.parse('2026-11-10T12:00:00Z');

const rows = (...items: [number, string, string][]) =>
  items.map(([rank, account_id, return_percent]) => ({
    rank,
    account_id,
    return_percent,
  }));

const period = (
  participant_count: number,
  entries: ReturnType<typeof rows>,
) => ({
  start: null,
  end: null,
  participant_count,
  rows: entries,
});

function board(computedAt = NOW) {
  const field = rows(
    [1, 'alice', '10.000000'],
    [2, 'bob', '-5.000000'],
    [3, 'c3', '-6.000000'],
    [4, 'c4', '-7.000000'],
    [5, 'c5', '-8.000000'],
    [6, 'c6', '-9.000000'],
  );
  return {
    computed_at: new Date(computedAt).toISOString(),
    periods: {
      continuous: period(6, field),
      weekly: period(6, field),
      monthly: period(6, field),
      yearly: period(0, []),
    },
  };
}

const position = (rank: number | null, reason: string | null = null) => ({
  start: null,
  end: null,
  participant_count: 6,
  return_percent: '-5.000000',
  baseline_value: '1000.00000000',
  rank,
  unranked_reason: reason,
  neighbourhood:
    rank == null
      ? []
      : rows([1, 'alice', '10.000000'], [2, 'bob', '-5.000000']),
});

const mine = {
  account_id: 'bob',
  computed_at: new Date(NOW).toISOString(),
  funding: 'funded',
  value: '950.12345678',
  periods: {
    continuous: position(2),
    weekly: position(2),
    monthly: position(2),
    yearly: position(null, 'no_fills'),
  },
};

const series = {
  account_id: 'bob',
  interval_seconds: 600,
  points: [
    { at: '2026-11-10T11:50:00+00:00', value: '1000.00000000' },
    { at: '2026-11-10T12:00:00+00:00', value: '950.12345678' },
  ],
};

type Call = { path: string; auth: string | null };

function harness(
  routes: Record<string, () => { status: number; body: unknown }>,
) {
  const calls: Call[] = [];
  const timers: (() => void)[] = [];
  let now = NOW;
  const feed = new CompetitionFeed({
    fetch: async (input, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const path = input.replace(/^\/website/, '');
      calls.push({ path, auth: headers.Authorization ?? null });
      const route = routes[path];
      if (!route) throw new TypeError('network');
      const { status, body } = route();
      return new Response(JSON.stringify(body), { status });
    },
    now: () => now,
    setTimeout: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout: () => {},
  });
  const settle = () => new Promise((done) => setTimeout(done, 0));
  return {
    feed,
    calls,
    settle,
    advance(ms: number) {
      now += ms;
    },
    async tick() {
      timers.shift()?.();
      await settle();
      await settle();
    },
  };
}

const ok = (body: unknown) => () => ({ status: 200, body });

test('signed out, the public leaderboard shows leaders without a position', async () => {
  const h = harness({ '/competition/leaderboard': ok(board()) });
  assert.equal(h.feed.getView().status, 'loading');
  h.feed.start();
  await h.settle();
  await h.settle();
  const view = h.feed.getView();
  assert.equal(view.status, 'ready');
  if (view.status !== 'ready') return;
  assert.equal(view.personal, null);
  assert.equal(view.periods.weekly.participantCount, 6);
  assert.deepEqual(
    view.periods.weekly.leaders.map((r) => [r.rank, r.name, r.returnPercent]),
    [
      [1, 'alice', 10],
      [2, 'bob', -5],
      [3, 'c3', -6],
      [4, 'c4', -7],
      [5, 'c5', -8],
    ],
  );
  assert.equal(view.periods.weekly.you, null);
  assert.deepEqual(h.calls, [{ path: '/competition/leaderboard', auth: null }]);
});

test('a token adds the caller value, positions, neighbourhood and series', async () => {
  const h = harness({
    '/competition/leaderboard': ok(board()),
    '/competition/me': ok(mine),
    '/competition/me/series': ok(series),
  });
  h.feed.start();
  h.feed.setToken('bob-token');
  await h.settle();
  await h.settle();
  const view = h.feed.getView();
  assert.equal(view.status, 'ready');
  if (view.status !== 'ready') return;
  assert.deepEqual(view.personal, {
    value: '950.12345678',
    baseline: '1000.00000000',
    performance: [1000, 950.12345678],
    times: [Date.parse('2026-11-10T11:50:00Z'), NOW],
  });
  assert.deepEqual(view.periods.weekly.you, {
    rank: 2,
    returnPercent: -5,
    reason: null,
  });
  assert.deepEqual(
    view.periods.weekly.nearby.map((r) => r.name),
    ['alice', 'bob'],
  );
  assert.deepEqual(view.periods.yearly.you, {
    rank: null,
    returnPercent: -5,
    reason: 'no_fills',
  });
  assert.ok(
    h.calls
      .filter((call) => call.path.startsWith('/competition/me'))
      .every((call) => call.auth === 'Bearer bob-token'),
  );
  // The series is refreshed every 10 minutes, not on every poll.
  const before = h.calls.filter(
    (c) => c.path === '/competition/me/series',
  ).length;
  await h.tick();
  const after = h.calls.filter(
    (c) => c.path === '/competition/me/series',
  ).length;
  assert.equal(after, before);

  h.feed.setToken(null);
  const signedOut = h.feed.getView();
  assert.ok(signedOut.status === 'ready' && signedOut.personal === null);
});

test('backend failure or stale standings show unavailable, never old data', async () => {
  let status = 200;
  const h = harness({
    '/competition/leaderboard': () => ({ status, body: board() }),
  });
  h.feed.start();
  await h.settle();
  await h.settle();
  assert.equal(h.feed.getView().status, 'ready');
  status = 503;
  h.advance(POLL_MS);
  await h.tick();
  assert.equal(h.feed.getView().status, 'unavailable');
  status = 200;
  h.advance(STALE_MS + 1);
  await h.tick();
  assert.equal(h.feed.getView().status, 'unavailable');
});

test('a first failed poll is unavailable rather than loading forever', async () => {
  const h = harness({});
  h.feed.start();
  await h.settle();
  await h.settle();
  assert.equal(h.feed.getView().status, 'unavailable');
});

test('a rejected token keeps public standings', async () => {
  const h = harness({
    '/competition/leaderboard': ok(board()),
    '/competition/me': () => ({
      status: 401,
      body: { error: 'invalid_token' },
    }),
  });
  h.feed.start();
  h.feed.setToken('bad');
  await h.settle();
  await h.settle();
  const view = h.feed.getView();
  assert.ok(view.status === 'ready' && view.personal === null);
});

test('long series are thinned evenly, keeping both ends', () => {
  const points = Array.from({ length: 1000 }, (_, index) => index);
  const thinned = thin(points, 5);
  assert.deepEqual(thinned, [0, 250, 500, 749, 999]);
  assert.equal(thin([1, 2, 3], 5).length, 3);
});
