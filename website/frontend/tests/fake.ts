/** Deterministic fakes for LiveSession: sockets, timers, and a controllable fetch. */
import { createRest } from '../src/live/rest.ts';
import type { Environment, SocketLike } from '../src/live/session.ts';
import { LiveSession } from '../src/live/session.ts';

export class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: unknown[] = [];
  closed = false;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.();
  }
  deliver(...frames: string[]) {
    for (const data of frames) this.onmessage?.({ data });
  }
  drop(code = 1006, reason = '') {
    this.closed = true;
    this.onclose?.({ code, reason });
  }
}

type Reply = { status: number; body: unknown };
type Pending = {
  path: string;
  auth: string | null;
  resolve: (reply: Reply) => void;
  reject: (error: Error) => void;
};

export function harness() {
  const sockets: FakeSocket[] = [];
  const requests: Pending[] = [];
  let now = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  let nextTimer = 1;
  const fetcher = (input: string, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      requests.push({
        path: input.replace(/^\/exchange/, ''),
        auth: headers.Authorization ?? null,
        resolve: ({ status, body }) =>
          resolve(new Response(JSON.stringify(body), { status })),
        reject,
      });
    });
  const env: Environment = {
    rest: createRest('/exchange', fetcher),
    openSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    setTimeout: (callback, ms) => {
      const id = nextTimer++;
      timers.set(id, { at: now + ms, callback });
      return id;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
    random: () => 0.5,
  };
  const session = new LiveSession(env);
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  };
  return {
    session,
    sockets,
    requests,
    flush,
    pendingTimers: () => timers.size,
    /** Answer the oldest pending request for `path` (prefix match). */
    async reply(path: string, body: unknown, status = 200) {
      await flush();
      const index = requests.findIndex((request) =>
        request.path.startsWith(path),
      );
      if (index < 0)
        throw new Error(
          `No pending request for ${path}: ${requests.map((r) => r.path).join(', ')}`,
        );
      const [request] = requests.splice(index, 1);
      request?.resolve({ status, body });
      await flush();
      return request as Pending;
    },
    async fail(path: string) {
      await flush();
      const index = requests.findIndex((request) =>
        request.path.startsWith(path),
      );
      const [request] = requests.splice(index, 1);
      request?.reject(new TypeError('network'));
      await flush();
    },
    async advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at))
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
      await flush();
    },
  };
}

export const instruments = (process = 'process-1') => ({
  process_id: process,
  data: [
    {
      instrument_id: 'QC-EUR',
      base_asset: 'QC',
      quote_asset: 'EUR',
      price_increment: '0.01',
      quantity_increment: '0.1',
    },
  ],
});
export const page = (data: unknown[], process = 'process-1') => ({
  process_id: process,
  commit_id: 0,
  data,
  next_cursor: null,
  high_watermark: data.length,
});
