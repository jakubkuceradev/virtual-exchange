/**
 * @implemented-ui Live exchange session: owns the public and private subscriptions,
 * recovery, and the participant-facing view of both.
 *
 * - Public socket (book, trades) runs regardless of credentials.
 * - Private socket (orders, fills) runs only for a token with read access.
 * - Every connection attempt is a Link; async continuations check `link.alive`,
 *   so late replies/events from an old token, account, or process are dropped.
 * - Recovery: subscribe first and buffer, fetch REST state, then apply buffered
 *   observations. Any stream break, missed heartbeat, or close resynchronizes
 *   with bounded backoff. A new process identity clears everything.
 * - The token lives only in this object's memory.
 */
import { isMultiple, isZero, normalizeInput } from '../trading/decimal.ts';
import type {
  AccountView,
  Identity,
  MarketView,
  OrderInput,
  Outcome,
} from '../trading/types.ts';
import type { AccountSnapshot, AccountState } from './account.ts';
import {
  applyBalances,
  applyFills,
  applyOrders,
  balancesResponse,
  fillRows,
  holding,
  install,
  orderRows,
  snapshot,
} from './account.ts';
import type { BookState, Trades } from './market.ts';
import {
  applyLevels,
  bookFromSnapshot,
  candles,
  mergeTrades,
  ordered,
  stats,
  toBook,
} from './market.ts';
import type { StreamEvent } from './protocol.ts';
import { Assembler, ProcessChanged } from './protocol.ts';
import type { Rest } from './rest.ts';
import { RestFailure } from './rest.ts';
import type { WireInstrument, WireOrder } from './wire.ts';
import {
  instrument as decodeInstrument,
  order as decodeOrder,
  list,
  object,
  text,
} from './wire.ts';

export type SocketLike = {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

export type Environment = {
  rest: Rest;
  openSocket: () => SocketLike;
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  random: () => number;
  randomBytes: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;
};

/** Heartbeats arrive every 10 s; allow 2.5 intervals before resynchronizing. */
export const HEARTBEAT_DEADLINE_MS = 25_000;
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 15_000;

export type CommandState = {
  busy: boolean;
  /** Message for a submission whose outcome is unknown; blocks new submissions. */
  unresolved: string | null;
  /** True once a resync and lookup have both failed to find the unresolved order. */
  canDismiss: boolean;
  feedback: Outcome | null;
};

const IDLE: CommandState = {
  busy: false,
  unresolved: null,
  canDismiss: false,
  feedback: null,
};
/** Lookups after an ambiguous submit: 1 s, 2 s, 4 s, 8 s, 16 s. */
const LOOKUP_ATTEMPTS = 5;

/** Canonical lowercase UUIDv4 from getRandomValues (works outside secure contexts). */
export function uuidV4(
  random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>,
) {
  const bytes = random(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

const STATUS_TEXT: Record<WireOrder['status'], string> = {
  open: 'is open',
  partially_filled: 'is partly filled and still open',
  filled: 'is filled',
  cancelled: 'is cancelled',
};

export type LiveView = {
  identity: Identity | null;
  market: MarketView;
  account: AccountView;
  notice: string | null;
  commands: CommandState;
};

type AccountPhase =
  | 'signed-out'
  | 'connecting'
  | 'syncing'
  | 'ready'
  | 'stale'
  | 'rejected'
  | 'no-read'
  | 'not-provisioned';

class Link {
  alive = true;
  socket: SocketLike | null = null;
  watchdog: unknown = null;
}

const initials = (name: string) =>
  name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase() || name.slice(0, 2).toUpperCase();

export class LiveSession {
  private readonly listeners = new Set<() => void>();
  private view: LiveView;
  private running = false;

  private processId: string | null = null;
  private instrument: WireInstrument | null = null;
  private restartedAt: number | null = null;

  // Public market
  private publicLink: Link | null = null;
  private publicAttempt = 0;
  private publicRetry: unknown = null;
  private marketPhase: MarketView['status'] = 'connecting';
  private book: BookState | null = null;
  private bookLive = false;
  private trades: Trades = new Map();
  private tradesSynced = false;
  private bufferedTrades: unknown[] = [];

  // Private account
  private token: string | null = null;
  private privateLink: Link | null = null;
  private privateAttempt = 0;
  private privateRetry: unknown = null;
  private accountPhase: AccountPhase = 'signed-out';
  private accountId: string | null = null;
  private permissions: readonly string[] = [];
  private account: AccountState | null = null;
  private bufferedPrivate: StreamEvent[] = [];
  private balancesInFlight = false;
  private balancesQueued = false;

  private commands: CommandState = IDLE;
  /** Bumped whenever the account/process changes; stale command replies are dropped. */
  private epoch = 0;
  private pending: {
    clientOrderId: string;
    epoch: number;
    attempts: number;
    timer: unknown;
    resyncedSince: boolean;
  } | null = null;

  private readonly env: Environment;

  constructor(env: Environment) {
    this.env = env;
    this.view = this.compose();
  }

  // ---- Observation API (useSyncExternalStore) ----

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getView = () => this.view;

  private emit() {
    this.view = this.compose();
    for (const listener of this.listeners) listener();
  }

  // ---- Lifecycle ----

  start() {
    if (this.running) return;
    this.running = true;
    this.startPublic();
    if (this.token) this.startPrivate();
  }

  /** Close sockets and timers (navigation/unmount). Credentials stay in memory. */
  stop() {
    this.running = false;
    this.endPublic();
    this.endPrivate();
    this.env.clearTimeout(this.publicRetry);
    this.env.clearTimeout(this.privateRetry);
  }

  async connect(token: string) {
    this.disconnect();
    this.epoch++;
    this.token = token;
    this.accountPhase = 'connecting';
    this.emit();
    if (this.running) await this.startPrivate();
  }

  disconnect() {
    this.endPrivate();
    this.env.clearTimeout(this.privateRetry);
    this.token = null;
    this.accountId = null;
    this.permissions = [];
    this.account = null;
    this.accountPhase = 'signed-out';
    this.privateAttempt = 0;
    this.epoch++;
    this.clearPending();
    this.commands = IDLE;
    this.emit();
  }

  // ---- Shared helpers ----

  private backoff(attempt: number) {
    const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
    return ceiling / 2 + (this.env.random() * ceiling) / 2;
  }

  private open(
    link: Link,
    channels: string[],
    token: string | null,
    handle: (event: StreamEvent) => void,
    closed: (code: number, reason: string) => void,
  ) {
    const assembler = new Assembler(channels, this.processId);
    const socket = this.env.openSocket();
    link.socket = socket;
    const arm = () => {
      this.env.clearTimeout(link.watchdog);
      link.watchdog = this.env.setTimeout(() => {
        if (link.alive) closed(0, 'heartbeat_missed');
      }, HEARTBEAT_DEADLINE_MS);
    };
    socket.onopen = () => {
      if (!link.alive) return;
      arm();
      socket.send(
        JSON.stringify(
          token
            ? { type: 'subscribe', channels, token }
            : { type: 'subscribe', channels },
        ),
      );
    };
    socket.onmessage = (event) => {
      if (!link.alive) return;
      arm();
      try {
        if (typeof event.data !== 'string') throw new Error('Binary frame');
        for (const item of assembler.feed(event.data)) handle(item);
      } catch (error) {
        if (error instanceof ProcessChanged) this.processChanged();
        else if (link.alive) closed(0, 'stream_broken');
      }
    };
    socket.onclose = (event) => {
      if (link.alive) closed(event.code, event.reason);
    };
    socket.onerror = () => {};
  }

  private kill(link: Link | null) {
    if (!link) return;
    link.alive = false;
    this.env.clearTimeout(link.watchdog);
    try {
      link.socket?.close(1000);
    } catch {
      // Already closed.
    }
  }

  /** Reject REST data from another process: the exchange restarted. */
  private sameProcess(processId: string) {
    if (this.processId === null) this.processId = processId;
    if (processId === this.processId) return true;
    this.processChanged();
    return false;
  }

  private processChanged() {
    const restarted = this.processId !== null;
    this.endPublic();
    this.endPrivate();
    this.processId = null;
    this.instrument = null;
    this.book = null;
    this.bookLive = false;
    this.trades = new Map();
    this.tradesSynced = false;
    this.account = null;
    if (restarted) this.restartedAt = Date.now();
    this.epoch++;
    this.clearPending();
    this.commands = {
      ...IDLE,
      feedback: this.commands.unresolved
        ? {
            kind: 'info',
            message:
              'The exchange restarted before the unresolved order was confirmed. It was not carried over; nothing was resubmitted.',
          }
        : this.commands.feedback,
    };
    this.marketPhase = 'connecting';
    if (this.accountPhase === 'ready' || this.accountPhase === 'syncing')
      this.accountPhase = 'connecting';
    this.emit();
    if (!this.running) return;
    this.publicAttempt = 0;
    this.privateAttempt = 0;
    this.startPublic();
    if (this.token) void this.startPrivate();
  }

  // ---- Public market ----

  private endPublic() {
    this.kill(this.publicLink);
    this.publicLink = null;
  }

  private retryPublic() {
    this.endPublic();
    this.bookLive = false;
    this.tradesSynced = false;
    this.marketPhase = this.book ? 'stale' : 'unavailable';
    this.emit();
    if (!this.running) return;
    this.env.clearTimeout(this.publicRetry);
    this.publicRetry = this.env.setTimeout(
      () => this.startPublic(),
      this.backoff(this.publicAttempt++),
    );
  }

  private async startPublic() {
    this.endPublic();
    const link = new Link();
    this.publicLink = link;
    this.bufferedTrades = [];
    try {
      if (!this.instrument) {
        const raw = object(
          await this.env.rest.get('/instruments'),
          'instruments',
        );
        if (!link.alive) return;
        if (!this.sameProcess(text(raw.process_id))) return;
        const first = list(raw.data)[0];
        if (!first) throw new Error('No instrument');
        this.instrument = decodeInstrument(first);
        this.emit();
      }
    } catch {
      if (link.alive) this.retryPublic();
      return;
    }
    this.open(
      link,
      ['book', 'trades'],
      null,
      (event) => this.onPublic(link, event),
      () => this.retryPublic(),
    );
  }

  private onPublic(link: Link, event: StreamEvent) {
    switch (event.kind) {
      case 'subscribed':
        void this.syncTrades(link);
        return;
      case 'snapshot':
        this.book = bookFromSnapshot(event.payload);
        this.bookLive = true;
        break;
      case 'update':
        if (event.channel === 'book') {
          if (!this.book || !this.bookLive)
            throw new Error('Update before snapshot');
          this.book = applyLevels(this.book, event.payload);
        } else if (this.tradesSynced)
          this.trades = mergeTrades(this.trades, event.payload);
        else {
          this.bufferedTrades.push(event.payload);
          return;
        }
        break;
      case 'heartbeat':
        return;
    }
    this.marketReady();
    this.emit();
  }

  private async syncTrades(link: Link) {
    try {
      const page = await this.env.rest.all('/trades');
      if (!link.alive || !this.sameProcess(page.processId)) return;
      let trades = mergeTrades(this.trades, page.data);
      for (const payload of this.bufferedTrades)
        trades = mergeTrades(trades, payload);
      this.bufferedTrades = [];
      this.trades = trades;
      this.tradesSynced = true;
      this.marketReady();
      this.emit();
    } catch {
      if (link.alive) this.retryPublic();
    }
  }

  private marketReady() {
    if (this.bookLive && this.tradesSynced) {
      this.marketPhase = 'ready';
      this.publicAttempt = 0;
    }
  }

  // ---- Private account ----

  private endPrivate() {
    this.kill(this.privateLink);
    this.privateLink = null;
  }

  private stopPrivate(phase: AccountPhase) {
    this.endPrivate();
    this.env.clearTimeout(this.privateRetry);
    this.accountPhase = phase;
    if (phase === 'rejected') {
      this.token = null;
      this.accountId = null;
      this.permissions = [];
    }
    this.account = null;
    this.emit();
  }

  private retryPrivate() {
    this.endPrivate();
    if (this.account) this.accountPhase = 'stale';
    else this.accountPhase = 'connecting';
    this.emit();
    if (!this.running || !this.token) return;
    this.env.clearTimeout(this.privateRetry);
    this.privateRetry = this.env.setTimeout(
      () => void this.startPrivate(),
      this.backoff(this.privateAttempt++),
    );
  }

  private async startPrivate() {
    this.endPrivate();
    const token = this.token;
    if (!token) return;
    const link = new Link();
    this.privateLink = link;
    this.bufferedPrivate = [];
    try {
      const raw = object(
        await this.env.rest.get('/identity', token),
        'identity',
      );
      if (!link.alive) return;
      this.accountId = text(raw.account_id);
      this.permissions = list(raw.permissions).map((value) => text(value));
    } catch (error) {
      if (!link.alive) return;
      if (error instanceof RestFailure && error.kind === 'unauthenticated')
        this.stopPrivate('rejected');
      else this.retryPrivate();
      return;
    }
    if (!this.permissions.includes('read')) {
      this.stopPrivate('no-read');
      return;
    }
    if (this.accountPhase !== 'stale') this.accountPhase = 'connecting';
    this.emit();
    this.open(
      link,
      ['orders', 'fills'],
      token,
      (event) => this.onPrivate(link, token, event),
      (code, reason) => {
        if (code === 4401) this.stopPrivate('rejected');
        else if (code === 4403)
          this.stopPrivate(
            reason === 'account_not_provisioned'
              ? 'not-provisioned'
              : 'no-read',
          );
        else this.retryPrivate();
      },
    );
  }

  private onPrivate(link: Link, token: string, event: StreamEvent) {
    if (event.kind === 'subscribed') {
      void this.syncAccount(link, token);
      return;
    }
    if (event.kind !== 'update') return;
    if (this.accountPhase !== 'ready' || !this.account) {
      this.bufferedPrivate.push(event);
      return;
    }
    this.account = this.applyPrivate(this.account, event);
    this.matchPending();
    this.emit();
    void this.refreshBalances(link, token);
  }

  private applyPrivate(state: AccountState, event: StreamEvent): AccountState {
    if (event.kind !== 'update') return state;
    return event.channel === 'orders'
      ? applyOrders(state, event.payload)
      : applyFills(state, event.payload);
  }

  private async syncAccount(link: Link, token: string) {
    this.accountPhase = this.account ? 'stale' : 'syncing';
    let base: AccountSnapshot;
    let fills: unknown[];
    try {
      base = snapshot(await this.env.rest.get('/account/snapshot', token));
      if (!link.alive || !this.sameProcess(base.processId)) return;
      const page = await this.env.rest.all('/fills', token, {
        high_watermark: String(base.fillHighWatermark),
      });
      if (!link.alive || !this.sameProcess(page.processId)) return;
      fills = page.data;
    } catch (error) {
      if (!link.alive) return;
      if (error instanceof RestFailure && error.kind === 'unauthenticated')
        this.stopPrivate('rejected');
      else if (error instanceof RestFailure && error.kind === 'forbidden')
        this.stopPrivate(
          error.code === 'account_not_provisioned'
            ? 'not-provisioned'
            : 'no-read',
        );
      else this.retryPrivate();
      return;
    }
    let state = install(base, fills);
    const newer = this.bufferedPrivate.some(
      (event) => event.kind === 'update' && event.commitId > base.commitId,
    );
    for (const event of this.bufferedPrivate)
      state = this.applyPrivate(state, event);
    this.bufferedPrivate = [];
    this.account = state;
    this.accountPhase = 'ready';
    this.privateAttempt = 0;
    if (this.pending) this.pending.resyncedSince = true;
    this.matchPending();
    this.emit();
    if (newer) void this.refreshBalances(link, token);
  }

  /** Coalesced: one request in flight, at most one queued behind it. */
  private async refreshBalances(link: Link, token: string) {
    if (this.balancesInFlight) {
      this.balancesQueued = true;
      return;
    }
    this.balancesInFlight = true;
    try {
      const reply = balancesResponse(
        await this.env.rest.get('/balances', token),
      );
      if (link.alive && this.account && this.sameProcess(reply.processId)) {
        this.account = applyBalances(this.account, reply.balances);
        this.emit();
      }
    } catch {
      // A later observation or resync refreshes balances again.
    } finally {
      this.balancesInFlight = false;
      if (this.balancesQueued && link.alive) {
        this.balancesQueued = false;
        void this.refreshBalances(link, token);
      }
    }
  }

  // ---- Commands ----

  clearFeedback = () => {
    if (!this.commands.feedback) return;
    this.commands = { ...this.commands, feedback: null };
    this.emit();
  };

  private setCommands(next: Partial<CommandState>) {
    this.commands = { ...this.commands, ...next };
    this.emit();
  }

  /** Why a command cannot be sent now, or null. */
  private refusal(): string | null {
    if (this.commands.busy) return 'Wait for the previous action to finish.';
    if (this.accountPhase !== 'ready' || !this.account)
      return 'Your account is not up to date yet.';
    if (!this.permissions.includes('trade')) return 'This token is read-only.';
    if (this.marketPhase !== 'ready')
      return 'The market is not up to date yet.';
    return null;
  }

  private validate(input: OrderInput): Outcome | null {
    const instrument = this.instrument;
    if (!instrument)
      return { kind: 'rejected', message: 'The market is not loaded yet.' };
    const price = normalizeInput(input.price);
    if (
      !price ||
      isZero(price) ||
      !isMultiple(price, instrument.priceIncrement)
    )
      return {
        kind: 'rejected',
        field: 'price',
        message: `Enter a positive price in steps of ${instrument.priceIncrement} ${instrument.quoteAsset}.`,
      };
    const quantity = normalizeInput(input.quantity);
    if (
      !quantity ||
      isZero(quantity) ||
      !isMultiple(quantity, instrument.quantityIncrement)
    )
      return {
        kind: 'rejected',
        field: 'quantity',
        message: `Enter a positive quantity in steps of ${instrument.quantityIncrement} ${instrument.baseAsset}.`,
      };
    return null;
  }

  submit = async (input: OrderInput): Promise<Outcome> => {
    const refused = this.commands.unresolved ?? this.refusal();
    if (refused) return { kind: 'rejected', message: refused };
    const invalid = this.validate(input);
    if (invalid) {
      this.setCommands({ feedback: invalid });
      return invalid;
    }
    const instrument = this.instrument as WireInstrument;
    const token = this.token as string;
    const epoch = this.epoch;
    // One client ID per deliberate action, retained for reconciliation.
    const clientOrderId = uuidV4(this.env.randomBytes);
    const body = {
      instrument_id: instrument.instrumentId,
      side: input.side,
      price: normalizeInput(input.price),
      quantity: normalizeInput(input.quantity),
      client_order_id: clientOrderId,
      type: 'limit',
    };
    this.setCommands({ busy: true, feedback: null });
    let outcome: Outcome;
    try {
      const receipt = object(await this.env.rest.post('/orders', body, token));
      if (epoch !== this.epoch) return this.superseded();
      outcome = {
        kind: 'accepted',
        message: `Order ${text(receipt.order_id).slice(0, 8)} accepted. Its status below updates as the exchange matches it.`,
      };
    } catch (error) {
      if (epoch !== this.epoch) return this.superseded();
      outcome = this.submitFailure(error, instrument, clientOrderId);
    }
    this.setCommands({ busy: false, feedback: outcome });
    this.refreshAfterCommand();
    return outcome;
  };

  private superseded(): Outcome {
    return {
      kind: 'info',
      message: 'The connection changed before the exchange replied.',
    };
  }

  private submitFailure(
    error: unknown,
    instrument: WireInstrument,
    clientOrderId: string,
  ): Outcome {
    if (!(error instanceof RestFailure)) return this.unresolve(clientOrderId);
    switch (error.kind) {
      case 'conflict':
        if (error.code === 'insufficient_funds')
          return {
            kind: 'rejected',
            field: 'quantity',
            message: `Not enough available funds: buys reserve price × quantity in ${instrument.quoteAsset}; sells reserve ${instrument.baseAsset}. Open orders keep their reservations.`,
          };
        // A duplicate of a fresh ID means an earlier attempt may have landed.
        return this.unresolve(clientOrderId);
      case 'invalid':
        return {
          kind: 'rejected',
          message:
            'The exchange rejected the order. Check that price and quantity match the market increments.',
        };
      case 'unauthenticated':
        this.stopPrivate('rejected');
        return {
          kind: 'rejected',
          message: 'Your token is no longer accepted.',
        };
      case 'forbidden':
        return {
          kind: 'rejected',
          message:
            error.code === 'account_not_provisioned'
              ? 'This account has no trading allocation.'
              : 'This token cannot place orders.',
        };
      case 'unavailable':
        return {
          kind: 'rejected',
          message:
            'The exchange is not accepting orders right now. Nothing was submitted.',
        };
      default:
        return this.unresolve(clientOrderId);
    }
  }

  /** The submit may or may not have committed: look it up, never resubmit. */
  private unresolve(clientOrderId: string): Outcome {
    this.clearPending();
    this.pending = {
      clientOrderId,
      epoch: this.epoch,
      attempts: 0,
      timer: null,
      resyncedSince: false,
    };
    const message =
      'The exchange did not confirm your order. Checking whether it was received — it will not be sent again automatically.';
    this.commands = {
      ...this.commands,
      unresolved: message,
      canDismiss: false,
    };
    void this.lookup();
    return { kind: 'unresolved', message };
  }

  private clearPending() {
    if (this.pending) this.env.clearTimeout(this.pending.timer);
    this.pending = null;
  }

  private resolvePending(order: WireOrder) {
    this.clearPending();
    this.setCommands({
      unresolved: null,
      canDismiss: false,
      feedback: {
        kind: 'accepted',
        message: `The exchange received your order ${order.orderId.slice(0, 8)}; it ${STATUS_TEXT[order.status]}.`,
      },
    });
  }

  private matchPending() {
    const pending = this.pending;
    if (!pending || !this.account) return;
    for (const order of this.account.orders.values())
      if (order.clientOrderId === pending.clientOrderId) {
        this.resolvePending(order);
        return;
      }
  }

  private async lookup() {
    const pending = this.pending;
    const token = this.token;
    if (!pending || !token) return;
    pending.attempts++;
    try {
      const raw = object(
        await this.env.rest.get(
          `/orders/client:${pending.clientOrderId}`,
          token,
        ),
      );
      if (this.pending !== pending || pending.epoch !== this.epoch) return;
      if (!this.sameProcess(text(raw.process_id))) return;
      this.resolvePending(decodeOrder(raw.data));
      return;
    } catch (error) {
      if (this.pending !== pending) return;
      const missing =
        error instanceof RestFailure && error.kind === 'not_found';
      // Not found proves nothing on its own; allow dismissal only after a full
      // private resync completed since the ambiguous submit also missed it.
      if (missing && pending.resyncedSince && !this.commands.canDismiss)
        this.setCommands({
          canDismiss: true,
          unresolved:
            'Your order was not found after refreshing your account. If it reaches the exchange later it will appear under Your orders. You can dismiss this to continue.',
        });
    }
    if (pending.attempts < LOOKUP_ATTEMPTS)
      pending.timer = this.env.setTimeout(
        () => void this.lookup(),
        1000 * 2 ** (pending.attempts - 1),
      );
  }

  /** Re-check an unresolved order: full private resync, then a lookup. */
  checkUnresolved = () => {
    const pending = this.pending;
    if (!pending) return;
    pending.attempts = 0;
    pending.resyncedSince = false;
    this.env.clearTimeout(pending.timer);
    void this.startPrivate();
    pending.timer = this.env.setTimeout(() => void this.lookup(), 1000);
  };

  dismissUnresolved = () => {
    if (!this.commands.canDismiss) return;
    this.clearPending();
    this.setCommands({ unresolved: null, canDismiss: false });
  };

  cancel = async (orderId: string): Promise<Outcome> => {
    const refused = this.refusal();
    if (refused) return { kind: 'rejected', message: refused };
    const token = this.token as string;
    const epoch = this.epoch;
    const label = orderId.slice(0, 8);
    this.setCommands({ busy: true, feedback: null });
    let outcome: Outcome;
    try {
      await this.env.rest.delete(
        `/orders/${encodeURIComponent(orderId)}`,
        token,
      );
      if (epoch !== this.epoch) return this.superseded();
      outcome = {
        kind: 'accepted',
        message: `Order ${label} cancelled. Its reservation is released.`,
      };
    } catch (error) {
      if (epoch !== this.epoch) return this.superseded();
      outcome = await this.cancelFailure(error, orderId, token, epoch);
    }
    this.setCommands({ busy: false, feedback: outcome });
    this.refreshAfterCommand();
    return outcome;
  };

  /** A lost race or unknown result: show the order's actual state. */
  private async cancelFailure(
    error: unknown,
    orderId: string,
    token: string,
    epoch: number,
  ): Promise<Outcome> {
    const label = orderId.slice(0, 8);
    if (error instanceof RestFailure && error.kind === 'not_found')
      return { kind: 'rejected', message: `Order ${label} was not found.` };
    if (error instanceof RestFailure && error.kind === 'unauthenticated') {
      this.stopPrivate('rejected');
      return { kind: 'rejected', message: 'Your token is no longer accepted.' };
    }
    try {
      const raw = object(
        await this.env.rest.get(
          `/orders/${encodeURIComponent(orderId)}`,
          token,
        ),
      );
      if (epoch !== this.epoch || !this.sameProcess(text(raw.process_id)))
        return this.superseded();
      const current = decodeOrder(raw.data);
      if (this.account) this.account = applyOrders(this.account, [raw.data]);
      const finished =
        current.status === 'filled' || current.status === 'cancelled';
      return finished
        ? {
            kind: 'info',
            message: `Order ${label} ${STATUS_TEXT[current.status]}; it finished before the cancellation took effect.`,
          }
        : {
            kind: 'rejected',
            message: `The cancellation of order ${label} was not confirmed; the order ${STATUS_TEXT[current.status]}. Try again.`,
          };
    } catch {
      return {
        kind: 'unresolved',
        message: `The cancellation of order ${label} was not confirmed. Its state will update when the connection recovers.`,
      };
    }
  }

  private refreshAfterCommand() {
    const link = this.privateLink;
    const token = this.token;
    if (link && token && this.account) void this.refreshBalances(link, token);
  }

  // ---- View composition ----

  private compose(): LiveView {
    const instrument = this.instrument;
    const sorted = ordered(this.trades);
    const last = sorted.at(-1);
    const market: MarketView = {
      status: this.marketPhase,
      instrument: instrument && {
        id: instrument.instrumentId,
        baseAsset: instrument.baseAsset,
        quoteAsset: instrument.quoteAsset,
        baseName: null,
        priceIncrement: instrument.priceIncrement,
        quantityIncrement: instrument.quantityIncrement,
      },
      book: this.book ? toBook(this.book) : null,
      lastPrice: last?.price ?? null,
      chart: candles(sorted),
      stats: stats(sorted),
      statsLabel: 'SESSION',
      historyNote: 'Since exchange start',
    };
    const identity: Identity | null = this.accountId
      ? {
          accountId: this.accountId,
          name: this.accountId,
          initials: initials(this.accountId),
          permissions: this.permissions,
        }
      : null;
    return {
      identity,
      market,
      account: this.composeAccount(),
      notice: this.notice(),
      commands: this.commands,
    };
  }

  private composeAccount(): AccountView {
    const phase = this.accountPhase;
    const accountId = this.accountId ?? '';
    if (phase === 'signed-out' || phase === 'rejected')
      return { status: phase };
    if (phase === 'no-read' || phase === 'not-provisioned')
      return { status: phase, accountId };
    if (!this.account || !this.instrument) return { status: 'connecting' };
    return this.ready(phase === 'ready' ? 'ready' : 'stale');
  }

  private ready(status: 'ready' | 'stale'): AccountView {
    const account = this.account as AccountState;
    const instrument = this.instrument as WireInstrument;
    return {
      status,
      accountId: this.accountId ?? '',
      canTrade: this.permissions.includes('trade'),
      cash: holding(account.balances, instrument.quoteAsset),
      asset: holding(account.balances, instrument.baseAsset),
      orders: orderRows(account),
      fills: fillRows(account),
    };
  }

  private notice(): string | null {
    const parts: string[] = [];
    if (this.restartedAt !== null)
      parts.push(
        `The development exchange restarted at ${new Date(this.restartedAt).toLocaleTimeString('en-GB')}. Balances were reset to their configured allocations and market history starts again; earlier orders were not carried over.`,
      );
    if (this.marketPhase === 'unavailable')
      parts.push('The exchange is unreachable. Retrying…');
    else if (this.marketPhase === 'stale' || this.accountPhase === 'stale')
      parts.push('Connection to the exchange was interrupted. Reconnecting…');
    return parts.length ? parts.join(' ') : null;
  }
}
