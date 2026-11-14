/**
 * @implemented-ui Pure private-account state built from authoritative observations.
 * Orders keep the highest commit version seen (never regress); fills are
 * deduplicated by fill ID; balances accept only a commit at least as new as the
 * one shown. Nothing here fabricates reservations, fills, or order states.
 * Retention is bounded: every resting order, plus the most recent closed orders
 * and fills, so memory and rendering stay constant for busy accounts.
 */
import { add } from '../trading/decimal.ts';
import type { Fill, Holding, Order } from '../trading/types.ts';
import type {
  WireBalance,
  WireFill,
  WireInstrument,
  WireOrder,
} from './wire.ts';
import {
  balance,
  baselines,
  fill,
  integer,
  list,
  object,
  order,
  text,
} from './wire.ts';

/** Closed (filled or cancelled) orders kept for display, newest first. */
export const CLOSED_ORDER_LIMIT = 50;
/** Fills kept for display, newest first. */
export const FILL_LIMIT = 50;

const resting = (entry: WireOrder) =>
  entry.status === 'open' || entry.status === 'partially_filled';
const newestOrder = (a: WireOrder, b: WireOrder) =>
  b.acceptedAt - a.acceptedAt || b.version - a.version;
const tradeNumber = (id: string) => BigInt(/^\d+$/.test(id) ? id : '0');
const newestFill = (a: WireFill, b: WireFill) => {
  const x = tradeNumber(a.tradeId),
    y = tradeNumber(b.tradeId);
  return x === y ? b.executedAt - a.executedAt : x < y ? 1 : -1;
};

/** Every resting order plus the most recent closed ones. */
function retainOrders(orders: Map<string, WireOrder>) {
  const closed = [...orders.values()].filter((entry) => !resting(entry));
  if (closed.length <= CLOSED_ORDER_LIMIT) return orders;
  for (const entry of closed.sort(newestOrder).slice(CLOSED_ORDER_LIMIT))
    orders.delete(entry.orderId);
  return orders;
}

function retainFills(fills: Map<string, WireFill>) {
  if (fills.size <= FILL_LIMIT) return fills;
  for (const entry of [...fills.values()].sort(newestFill).slice(FILL_LIMIT))
    fills.delete(entry.fillId);
  return fills;
}

export type Balances = { commitId: number; byAsset: Map<string, WireBalance> };

export type AccountState = {
  orders: ReadonlyMap<string, WireOrder>;
  fills: ReadonlyMap<string, WireFill>;
  balances: Balances;
};

export type AccountSnapshot = {
  processId: string;
  commitId: number;
  balances: Balances;
  orders: WireOrder[];
  fillHighWatermark: number;
  baselines: Record<string, number>;
};

export function snapshot(value: unknown): AccountSnapshot {
  const raw = object(value, 'account snapshot');
  const commitId = integer(raw.commit_id);
  return {
    processId: text(raw.process_id),
    commitId,
    balances: {
      commitId,
      byAsset: new Map(
        list(raw.balances)
          .map(balance)
          .map((entry) => [entry.assetId, entry]),
      ),
    },
    orders: list(raw.orders).map(order),
    fillHighWatermark: integer(raw.fill_high_watermark),
    baselines: baselines(raw.channel_baselines),
  };
}

export function balancesResponse(value: unknown): {
  processId: string;
  balances: Balances;
} {
  const raw = object(value, 'balances');
  return {
    processId: text(raw.process_id),
    balances: {
      commitId: integer(raw.commit_id),
      byAsset: new Map(
        list(raw.data)
          .map(balance)
          .map((entry) => [entry.assetId, entry]),
      ),
    },
  };
}

/**
 * Account state from a snapshot. Fill history arrives separately (applyFills);
 * `keep` carries fills already shown so a resync does not blank the table.
 */
export function install(
  base: AccountSnapshot,
  keep: ReadonlyMap<string, WireFill> = new Map(),
): AccountState {
  return {
    orders: retainOrders(
      new Map(base.orders.map((entry) => [entry.orderId, entry])),
    ),
    fills: retainFills(new Map(keep)),
    balances: base.balances,
  };
}

/** Apply order snapshots, keeping the newest commit version of each order. */
export function applyOrders(
  state: AccountState,
  payload: unknown,
): AccountState {
  const orders = new Map(state.orders);
  for (const incoming of list(payload, 'orders').map(order)) {
    const current = orders.get(incoming.orderId);
    if (!current || incoming.version > current.version)
      orders.set(incoming.orderId, incoming);
  }
  return { ...state, orders: retainOrders(orders) };
}

export function applyFills(
  state: AccountState,
  payload: unknown,
): AccountState {
  const fills = new Map(state.fills);
  for (const incoming of list(payload, 'fills').map(fill))
    fills.set(incoming.fillId, incoming);
  return { ...state, fills: retainFills(fills) };
}

/** Accept a balance reply only if it is not older than what is shown. */
export function applyBalances(
  state: AccountState,
  next: Balances,
): AccountState {
  return next.commitId >= state.balances.commitId
    ? { ...state, balances: next }
    : state;
}

const time = (epoch: number) =>
  new Date(epoch).toLocaleTimeString('en-GB', { hour12: false });

export function holding(balances: Balances, asset: string): Holding {
  const entry = balances.byAsset.get(asset);
  const available = entry?.available ?? '0';
  const reserved = entry?.reserved ?? '0';
  return { available, reserved, total: add(available, reserved) };
}

export function orderRows(state: AccountState): Order[] {
  return [...state.orders.values()].sort(newestOrder).map((entry) => ({
    id: entry.orderId,
    label: entry.orderId.slice(0, 8),
    side: entry.side,
    price: entry.price,
    quantity: entry.quantity,
    remaining: entry.remaining,
    status: entry.status,
  }));
}

export function fillRows(state: AccountState): Fill[] {
  return [...state.fills.values()].sort(newestFill).map((entry) => ({
    id: entry.fillId,
    side: entry.side,
    price: entry.price,
    quantity: entry.quantity,
    time: time(entry.executedAt),
  }));
}

export function assets(instrument: WireInstrument) {
  return { cash: instrument.quoteAsset, asset: instrument.baseAsset };
}
