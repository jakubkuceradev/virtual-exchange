/**
 * @implemented-ui Same-origin REST client for the exchange (proxied under /exchange).
 * Classifies every response so callers act on stable outcomes, never raw bodies.
 * The token is sent only as an Authorization header and never logged.
 */
import { object, text } from './wire.ts';

export type FailureKind =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'invalid'
  | 'unavailable'
  /** Network failure, timeout, or proxy/server error: the effect is unknown. */
  | 'ambiguous';

export class RestFailure extends Error {
  readonly kind: FailureKind;
  readonly code: string;
  readonly status: number | null;
  constructor(kind: FailureKind, code: string, status: number | null) {
    super(`${kind}: ${code}`);
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type Page = {
  processId: string;
  data: unknown[];
  nextCursor: string | null;
  highWatermark: number;
};

const TIMEOUT_MS = 10_000;

async function code(response: Response): Promise<string> {
  try {
    return text(object(await response.json()).error);
  } catch {
    return `http_${response.status}`;
  }
}

async function classify(response: Response): Promise<RestFailure> {
  const reason = await code(response);
  const status = response.status;
  const kind: FailureKind =
    status === 401
      ? 'unauthenticated'
      : status === 403
        ? 'forbidden'
        : status === 404
          ? 'not_found'
          : status === 409
            ? 'conflict'
            : status === 400
              ? 'invalid'
              : status === 503 && reason === 'trading_unavailable'
                ? // The exchange raises this before any effect.
                  'unavailable'
                : 'ambiguous';
  return new RestFailure(kind, reason, status);
}

export type Rest = ReturnType<typeof createRest>;

export function createRest(base = '/exchange', fetcher: Fetch = fetch) {
  async function request(
    method: string,
    path: string,
    token: string | null,
    body?: unknown,
  ): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await fetcher(`${base}${path}`, {
        method,
        headers,
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new RestFailure('ambiguous', 'network_error', null);
    }
    if (!response.ok) throw await classify(response);
    try {
      return await response.json();
    } catch {
      throw new RestFailure('ambiguous', 'malformed_response', response.status);
    }
  }
  const get = (path: string, token: string | null = null) =>
    request('GET', path, token);
  return {
    get,
    post: (path: string, body: unknown, token: string) =>
      request('POST', path, token, body),
    delete: (path: string, token: string) => request('DELETE', path, token),
    /** Follow opaque cursors to the end of a list fixed by its high watermark. */
    async all(
      path: string,
      token: string | null = null,
      params: Record<string, string> = {},
    ): Promise<Page> {
      const data: unknown[] = [];
      let cursor: string | null = null;
      let first: Page | null = null;
      do {
        const query = new URLSearchParams({ ...params, limit: '1000' });
        if (cursor) query.set('cursor', cursor);
        const raw = object(await get(`${path}?${query}`, token), 'page');
        const page: Page = {
          processId: text(raw.process_id),
          data: Array.isArray(raw.data) ? raw.data : [],
          nextCursor: raw.next_cursor == null ? null : text(raw.next_cursor),
          highWatermark: Number(raw.high_watermark),
        };
        if (first && page.processId !== first.processId)
          throw new RestFailure('ambiguous', 'process_changed', null);
        first ??= page;
        data.push(...page.data);
        cursor = page.nextCursor;
      } while (cursor);
      if (!first) throw new RestFailure('ambiguous', 'empty_page', null);
      return { ...first, data, nextCursor: null };
    },
  };
}
