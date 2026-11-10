/**
 * @implemented-ui Decoders for the exchange's JSON wire records.
 * Consumers depend on wire data only, never on exchange internals. Each decoder
 * checks the fields this client relies on and throws WireError otherwise.
 */
import type { Decimal } from '../trading/decimal.ts';
import { isCanonical } from '../trading/decimal.ts';
import type { NewsItem, OrderStatus, Side } from '../trading/types.ts';

export class WireError extends Error {}

type Raw = Record<string, unknown>;

export function object(value: unknown, what = 'record'): Raw {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new WireError(`Expected ${what} object`);
  return value as Raw;
}
export function list(value: unknown, what = 'list'): unknown[] {
  if (!Array.isArray(value)) throw new WireError(`Expected ${what}`);
  return value;
}
export function text(value: unknown, what = 'string'): string {
  if (typeof value !== 'string') throw new WireError(`Expected ${what}`);
  return value;
}
export function integer(value: unknown, what = 'integer'): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new WireError(`Expected ${what}`);
  return value;
}
export function decimal(value: unknown, what = 'amount'): Decimal {
  if (typeof value !== 'string' || !isCanonical(value))
    throw new WireError(`Expected decimal ${what}`);
  return value;
}
function side(value: unknown): Side {
  if (value !== 'buy' && value !== 'sell') throw new WireError('Expected side');
  return value;
}
function time(value: unknown): number {
  const epoch = Date.parse(text(value, 'timestamp'));
  if (Number.isNaN(epoch)) throw new WireError('Expected timestamp');
  return epoch;
}
const STATUSES = new Set(['open', 'partially_filled', 'filled', 'cancelled']);

export type WireInstrument = {
  instrumentId: string;
  baseAsset: string;
  quoteAsset: string;
  priceIncrement: Decimal;
  quantityIncrement: Decimal;
};
export function instrument(value: unknown): WireInstrument {
  const raw = object(value, 'instrument');
  return {
    instrumentId: text(raw.instrument_id),
    baseAsset: text(raw.base_asset),
    quoteAsset: text(raw.quote_asset),
    priceIncrement: decimal(raw.price_increment),
    quantityIncrement: decimal(raw.quantity_increment),
  };
}

export type WireBalance = {
  assetId: string;
  available: Decimal;
  reserved: Decimal;
};
export function balance(value: unknown): WireBalance {
  const raw = object(value, 'balance');
  return {
    assetId: text(raw.asset_id),
    available: decimal(raw.available),
    reserved: decimal(raw.reserved),
  };
}

export type WireOrder = {
  orderId: string;
  side: Side;
  price: Decimal;
  quantity: Decimal;
  remaining: Decimal;
  status: OrderStatus;
  acceptedAt: number;
  clientOrderId: string | null;
  version: number;
};
export function order(value: unknown): WireOrder {
  const raw = object(value, 'order');
  const status = text(raw.status);
  if (!STATUSES.has(status)) throw new WireError('Expected order status');
  return {
    orderId: text(raw.order_id),
    side: side(raw.side),
    price: decimal(raw.limit_price),
    quantity: decimal(raw.quantity),
    remaining: decimal(raw.remaining_quantity),
    status: status as OrderStatus,
    acceptedAt: time(raw.accepted_at),
    clientOrderId:
      raw.client_order_id == null ? null : text(raw.client_order_id),
    version: integer(raw.commit_version),
  };
}

export type WireFill = {
  fillId: string;
  tradeId: string;
  orderId: string;
  side: Side;
  price: Decimal;
  quantity: Decimal;
  executedAt: number;
};
export function fill(value: unknown): WireFill {
  const raw = object(value, 'fill');
  return {
    fillId: text(raw.fill_id),
    tradeId: text(raw.trade_id),
    orderId: text(raw.order_id),
    side: side(raw.side),
    price: decimal(raw.price),
    quantity: decimal(raw.quantity),
    executedAt: time(raw.executed_at),
  };
}

export type WireTrade = {
  tradeId: string;
  price: Decimal;
  quantity: Decimal;
  executedAt: number;
};
export function trade(value: unknown): WireTrade {
  const raw = object(value, 'trade');
  return {
    tradeId: text(raw.trade_id),
    price: decimal(raw.price),
    quantity: decimal(raw.quantity),
    executedAt: time(raw.executed_at),
  };
}

export function news(value: unknown): NewsItem {
  const raw = object(value, 'news item');
  return {
    id: text(raw.news_id),
    headline: text(raw.headline),
    body: raw.body == null ? null : text(raw.body),
    instrumentIds: list(raw.instrument_ids, 'instrument_ids').map((id) =>
      text(id),
    ),
    eventAt: raw.event_at == null ? null : time(raw.event_at),
    publishedAt: time(raw.published_at),
  };
}

export type WireLevel = { price: Decimal; quantity: Decimal };
export function level(value: unknown): WireLevel {
  const raw = object(value, 'level');
  return { price: decimal(raw.price), quantity: decimal(raw.quantity) };
}
export type WireLevelChange = WireLevel & { side: Side };
export function levelChange(value: unknown): WireLevelChange {
  const raw = object(value, 'level change');
  return { ...level(raw), side: side(raw.side) };
}

/** Channel baselines: an object of channel name to sequence. */
export function baselines(value: unknown): Record<string, number> {
  const raw = object(value, 'baselines');
  const result: Record<string, number> = {};
  for (const [channel, sequence] of Object.entries(raw))
    result[channel] = integer(sequence, 'sequence');
  return result;
}
