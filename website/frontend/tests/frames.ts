/** Test helpers that build exchange WebSocket envelopes. */
export const PROCESS = 'process-1';

export function frame(
  channel: string,
  sequence: number,
  type: string,
  payload: unknown,
  { commit = sequence, process = PROCESS } = {},
) {
  return JSON.stringify({
    process_id: process,
    channel,
    sequence,
    commit_id: commit,
    type,
    part: 1,
    parts: 1,
    payload,
  });
}

/** Split a payload into `parts` fragments sharing one sequence. */
export function fragments(
  channel: string,
  sequence: number,
  type: string,
  payload: unknown,
  parts: number,
  { commit = sequence, process = PROCESS } = {},
) {
  const raw = JSON.stringify(payload);
  const size = Math.ceil(raw.length / parts);
  return Array.from({ length: parts }, (_, index) =>
    JSON.stringify({
      process_id: process,
      channel,
      sequence,
      commit_id: commit,
      type,
      part: index + 1,
      parts,
      payload_fragment: raw.slice(index * size, (index + 1) * size),
    }),
  );
}

export const subscribed = (
  channels: Record<string, number>,
  options: { commit?: number; process?: string } = {},
) => frame('control', 0, 'subscribed', { channels }, { commit: 0, ...options });
export const heartbeat = (channels: Record<string, number>) =>
  frame('control', 0, 'heartbeat', { channels }, { commit: 0 });

export function bookSnapshot(
  sequence: number,
  bids: [string, string][],
  asks: [string, string][],
) {
  const levels = (side: [string, string][]) =>
    side.map(([price, quantity]) => ({ price, quantity }));
  return [
    frame('book', sequence, 'snapshot_start', {}),
    frame('book', sequence, 'snapshot', {
      bids: levels(bids),
      asks: levels(asks),
    }),
    frame('book', sequence, 'snapshot_end', {}),
  ];
}

export const tradeRecord = (
  id: string,
  price: string,
  quantity: string,
  at = '2026-11-07T12:00:00+00:00',
) => ({
  trade_id: id,
  instrument_id: 'QC-EUR',
  price,
  quantity,
  executed_at: at,
  maker_order_id: 'm',
  taker_order_id: 't',
});

export const orderRecord = (
  id: string,
  version: number,
  fields: Record<string, unknown> = {},
) => ({
  order_id: id,
  account_id: 'alice',
  instrument_id: 'QC-EUR',
  side: 'buy',
  quantity: '2',
  filled_quantity: '0',
  limit_price: '100.00',
  status: 'open',
  accepted_at: '2026-11-07T12:00:00+00:00',
  remaining_quantity: '2',
  client_order_id: null,
  cancelled_quantity: '0',
  prevented_quantity: '0',
  commit_version: version,
  ...fields,
});

export const fillRecord = (
  trade: string,
  order: string,
  fields: Record<string, unknown> = {},
) => ({
  fill_id: `${trade}:${order}`,
  trade_id: trade,
  order_id: order,
  instrument_id: 'QC-EUR',
  side: 'buy',
  price: '100.00',
  quantity: '2',
  executed_at: '2026-11-07T12:00:00+00:00',
  liquidity: 'taker',
  commit_version: 1,
  ...fields,
});
