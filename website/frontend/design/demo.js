import { initialBook, snapshot } from './fixtures.js';

// A disposable, in-memory design demo, not an exchange client or policy engine.
// Cash/prices use integer cents and the demo accepts whole QC units only.
export function createDemo() {
  const state = {
    cash: snapshot.cash, holdings: snapshot.holdings,
    book: structuredClone(initialBook),
    orders: [{ id: 'D-1041', side: 'buy', price: 11000, quantity: 50, remaining: 50, status: 'Open' }],
    fills: [{ id: 'F-0831', side: 'buy', price: 10920, quantity: 80, time: '13:42:08' }],
    credential: 'pqc_demo_only_0142_not_a_real_secret', credentialVersion: 1,
    nextId: 1042,
  };
  function available() {
    return state.orders.filter(order => order.status === 'Open').reduce((result, order) => {
      if (order.side === 'buy') result.cash -= order.price * order.remaining;
      else result.holdings -= order.remaining;
      return result;
    }, { cash: state.cash, holdings: state.holdings });
  }
  function submit({ side, price: rawPrice, quantity: rawQuantity }) {
    if (!['buy', 'sell'].includes(side)) return { field: 'side', error: 'Choose Buy or Sell.' };
    const priceText = String(rawPrice).trim();
    if (!/^\d+(\.\d{1,2})?$/.test(priceText) || Number(priceText) <= 0 || Number(priceText) > 1000000)
      return { field: 'price', error: 'Enter a price from 0.01 to 1,000,000 EUR, with at most two decimals.' };
    const quantityText = String(rawQuantity).trim();
    if (!/^\d+$/.test(quantityText) || Number(quantityText) < 1 || Number(quantityText) > 1000000)
      return { field: 'quantity', error: 'Enter a whole quantity from 1 to 1,000,000 QC.' };
    const price = Math.round(Number(priceText) * 100);
    const quantity = Number(quantityText);
    const resources = available();
    if (side === 'buy' && price * quantity > resources.cash)
      return { field: 'quantity', error: 'Not enough available cash for this order at its limit price.' };
    if (side === 'sell' && quantity > resources.holdings)
      return { field: 'quantity', error: 'Not enough available QC. Cancel an open sell order to release holdings.' };
    const order = { id: `D-${state.nextId++}`, side, price, quantity, remaining: quantity, status: 'Open' };
    const quotes = side === 'buy' ? state.book.asks : state.book.bids;
    let executed = 0;
    for (const quote of quotes) {
      if (!order.remaining || (side === 'buy' ? quote[0] > price : quote[0] < price)) break;
      const filled = Math.min(order.remaining, quote[1]);
      if (!filled) continue;
      order.remaining -= filled;
      quote[1] -= filled;
      executed += filled;
      const direction = side === 'buy' ? 1 : -1;
      state.cash -= direction * quote[0] * filled;
      state.holdings += direction * filled;
      state.fills.unshift({ id: `F-${order.id}-${state.fills.length}`, side, price: quote[0], quantity: filled, time: new Date(Date.UTC(2026, 10, 7, 14, 46, state.fills.length)).toISOString().slice(11, 19) });
    }
    state.book.asks = state.book.asks.filter(([, size]) => size > 0);
    state.book.bids = state.book.bids.filter(([, size]) => size > 0);
    order.status = order.remaining ? 'Open' : 'Filled';
    state.orders.unshift(order);
    const message = executed
      ? `${order.id}: ${executed} QC filled within your limit.${order.remaining ? ` ${order.remaining} QC remains open.` : ' Order complete.'}`
      : `${order.id}: limit ${side} for ${quantity} QC placed. Your order is open.`;
    return { order, message };
  }
  function cancel(id) {
    const order = state.orders.find(item => item.id === id);
    if (!order || order.status !== 'Open') return { error: 'This order is no longer open.' };
    order.status = 'Cancelled';
    return { message: `${id} cancelled. Unfilled ${order.remaining} QC released from the order.` };
  }
  function createCredential() {
    if (state.credential) return { error: 'Revoke the current sample key before creating another.' };
    state.credential = `pqc_demo_only_0142_v${++state.credentialVersion}_not_a_real_secret`;
    return { message: 'New sample key created. This key cannot access a real account.' };
  }
  function revokeCredential() {
    if (!state.credential) return { error: 'There is no active sample key.' };
    state.credential = null;
    return { message: 'Sample key revoked. Create a new key to continue the demonstration.' };
  }
  return { state, available, submit, cancel, createCredential, revokeCredential };
}
