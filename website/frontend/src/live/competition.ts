/**
 * @implemented-ui Live competition feed from the website backend (proxied under /website).
 * Polls the public leaderboard and, for a connected token, the caller's own
 * valuation and series. Any failure or stale snapshot yields the unavailable
 * state; it never substitutes fixtures. Late replies from an earlier token are
 * dropped by generation.
 */
import type { Period } from '../fixtures.ts';
import type { Decimal } from '../trading/decimal.ts';
import type {
  Competition,
  PeriodStanding,
  Personal,
  Position,
  Ranking,
} from '../trading/types.ts';
import type { Fetch } from './rest.ts';
import { list, object, text } from './wire.ts';

export const POLL_MS = 15_000;
export const SERIES_POLL_MS = 10 * 60_000;
/** Older standings are shown as unavailable rather than as current. */
export const STALE_MS = 3 * 60_000;
const LEADERS = 5;
/** Enough points for the chart width; a year of 10-minute values is ~52k. */
const MAX_POINTS = 400;
const PERIODS: Period[] = ['continuous', 'weekly', 'monthly', 'yearly'];

export type CompetitionEnvironment = {
  fetch: Fetch;
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

class FeedError extends Error {}

function percent(value: unknown): number {
  const parsed = Number(text(value, 'percentage'));
  if (!Number.isFinite(parsed)) throw new FeedError('Expected percentage');
  return parsed;
}
function amount(value: unknown): Decimal | null {
  if (value == null) return null;
  const raw = text(value, 'amount');
  if (!/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(raw))
    throw new FeedError('Expected amount');
  return raw;
}
function instant(value: unknown): number {
  const epoch = Date.parse(text(value, 'timestamp'));
  if (Number.isNaN(epoch)) throw new FeedError('Expected timestamp');
  return epoch;
}
function rankings(value: unknown): Ranking[] {
  return list(value, 'rows').map((item) => {
    const row = object(item, 'row');
    if (typeof row.rank !== 'number') throw new FeedError('Expected rank');
    return {
      rank: row.rank,
      name: text(row.account_id, 'account'),
      returnPercent: percent(row.return_percent),
    };
  });
}

type Board = {
  computedAt: number;
  periods: Record<Period, { participantCount: number; rows: Ranking[] }>;
};
type Mine = {
  value: Decimal | null;
  baseline: Decimal | null;
  positions: Record<Period, { you: Position; nearby: Ranking[] }>;
};

export function decodeBoard(body: unknown): Board {
  const raw = object(body, 'leaderboard');
  const periods = object(raw.periods, 'periods');
  const decoded = {} as Board['periods'];
  for (const period of PERIODS) {
    const item = object(periods[period], period);
    if (typeof item.participant_count !== 'number')
      throw new FeedError('Expected participant count');
    decoded[period] = {
      participantCount: item.participant_count,
      rows: rankings(item.rows),
    };
  }
  return { computedAt: instant(raw.computed_at), periods: decoded };
}

export function decodeMine(body: unknown): Mine {
  const raw = object(body, 'standing');
  const periods = object(raw.periods, 'periods');
  const positions = {} as Mine['positions'];
  for (const period of PERIODS) {
    const item = object(periods[period], period);
    positions[period] = {
      you: {
        rank: typeof item.rank === 'number' ? item.rank : null,
        returnPercent:
          item.return_percent == null ? null : percent(item.return_percent),
        reason:
          item.unranked_reason == null ? null : text(item.unranked_reason),
      },
      nearby: rankings(item.neighbourhood),
    };
  }
  const continuous = object(periods.continuous, 'continuous');
  return {
    value: amount(raw.value),
    baseline: amount(continuous.baseline_value),
    positions,
  };
}

/** Even thinning keeps the first and last points. */
export function thin<T>(points: T[], limit = MAX_POINTS): T[] {
  if (points.length <= limit) return points;
  const step = (points.length - 1) / (limit - 1);
  return Array.from(
    { length: limit },
    (_, index) => points[Math.round(index * step)] as T,
  );
}

export function decodeSeries(body: unknown): { at: number; value: number }[] {
  return thin(
    list(object(body, 'series').points, 'points').map((item) => {
      const point = object(item, 'point');
      return {
        at: instant(point.at),
        value: Number(amount(point.value) ?? 'NaN'),
      };
    }),
  );
}

/** Combine public standings with the caller's own record into one view. */
export function combine(
  board: Board,
  mine: Mine | null,
  series: { at: number; value: number }[],
): Competition {
  const periods = {} as Record<Period, PeriodStanding>;
  for (const period of PERIODS) {
    const { participantCount, rows } = board.periods[period];
    const own = mine?.positions[period];
    periods[period] = {
      participantCount,
      leaders: rows.slice(0, LEADERS),
      you: own?.you ?? null,
      nearby: own?.nearby ?? [],
    };
  }
  const personal: Personal | null = mine && {
    value: mine.value,
    baseline: mine.baseline,
    performance: series.map((point) => point.value),
    times: series.map((point) => point.at),
  };
  return {
    status: 'ready',
    computedAt: board.computedAt,
    periods,
    personal,
  };
}

export class CompetitionFeed {
  private readonly env: CompetitionEnvironment;
  private readonly base: string;
  private listeners = new Set<() => void>();
  private view: Competition = { status: 'loading' };
  private board: Board | null = null;
  /** Set once the first poll finishes, successfully or not. */
  private loaded = false;
  private mine: Mine | null = null;
  private series: { at: number; value: number }[] = [];
  private seriesAt = 0;
  private token: string | null = null;
  private generation = 0;
  private timer: unknown = null;
  private running = false;

  constructor(env: CompetitionEnvironment, base = '/website') {
    this.env = env;
    this.base = base;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getView = () => this.view;

  start() {
    if (this.running) return;
    this.running = true;
    void this.poll();
  }

  stop() {
    this.running = false;
    this.generation++;
    if (this.timer !== null) this.env.clearTimeout(this.timer);
    this.timer = null;
  }

  /** Use the connected token for the caller's record; null signs out. */
  setToken(token: string | null) {
    if (token === this.token) return;
    this.token = token;
    this.generation++;
    this.mine = null;
    this.series = [];
    this.seriesAt = 0;
    this.publish();
    if (this.running) {
      if (this.timer !== null) this.env.clearTimeout(this.timer);
      void this.poll();
    }
  }

  private async get(path: string, token: string | null): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await this.env.fetch(`${this.base}${path}`, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new FeedError(`HTTP ${response.status}`);
    return response.json();
  }

  private async poll() {
    const generation = this.generation;
    const token = this.token;
    try {
      const board = decodeBoard(
        await this.get('/competition/leaderboard', null),
      );
      let mine: Mine | null = null;
      let series = this.series;
      let seriesAt = this.seriesAt;
      if (token) {
        try {
          mine = decodeMine(await this.get('/competition/me', token));
          if (this.env.now() - seriesAt >= SERIES_POLL_MS) {
            series = decodeSeries(
              await this.get('/competition/me/series', token),
            );
            seriesAt = this.env.now();
          }
        } catch {
          // The caller's record is unavailable (unknown account, rejected
          // token); public standings still show.
          mine = null;
        }
      }
      if (generation !== this.generation) return;
      this.board = board;
      this.loaded = true;
      this.mine = mine;
      this.series = series;
      this.seriesAt = seriesAt;
    } catch {
      if (generation !== this.generation) return;
      this.board = null;
      this.loaded = true;
    }
    this.publish();
    if (this.running && generation === this.generation)
      this.timer = this.env.setTimeout(() => {
        this.timer = null;
        void this.poll();
      }, POLL_MS);
  }

  private publish() {
    const board = this.board;
    this.view = !this.loaded
      ? { status: 'loading' }
      : board == null
        ? { status: 'unavailable' }
        : this.env.now() - board.computedAt > STALE_MS
          ? { status: 'unavailable' }
          : combine(board, this.mine, this.series);
    for (const listener of this.listeners) listener();
  }
}
