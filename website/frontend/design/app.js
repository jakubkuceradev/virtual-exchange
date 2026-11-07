import { candles, participant, performance, periods, snapshot } from './fixtures.js';
import { createDemo } from './demo.js';

const demo = createDemo();
const $ = selector => document.querySelector(selector);
const all = selector => [...document.querySelectorAll(selector)];
const money = cents => (cents / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const number = value => value.toLocaleString('en-GB');
const signed = value => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}%`;
const initials = name => name.split(/[ ._]+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();
const emptyPreview = new URLSearchParams(location.search).get('scenario') === 'no-trades';

function renderPerformance() {
  if (emptyPreview) {
    $('#performance-chart').innerHTML = '<div class="chart-empty"><strong>No performance history yet</strong><p>Your account history will appear here.</p></div>';
    return;
  }
  const width = 610, left = 20, right = 545, top = 22, bottom = 195;
  const y = value => bottom - (value - 95000) / 45000 * (bottom - top);
  const points = performance.map((value, index) => `${left + index / (performance.length - 1) * (right - left)},${y(value)}`);
  const guides = [100000, 110000, 120000, 130000].map(value => `<line x1="${left}" x2="${right}" y1="${y(value)}" y2="${y(value)}" stroke="#252936" stroke-dasharray="3 5"/><text x="558" y="${y(value) + 4}">${value / 1000}k</text>`).join('');
  $('#performance-chart').innerHTML = `<svg viewBox="0 0 ${width} 230" role="img" aria-labelledby="performance-svg-title performance-svg-description"><title id="performance-svg-title">Personal account value</title><desc id="performance-svg-description">Fixed sample history rises from 100,000 EUR to 130,450 EUR between 15 October and 7 November 2026. This is illustrative, not live performance.</desc><defs><linearGradient id="performance-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#5b5bf0" stop-opacity=".25"/><stop offset="100%" stop-color="#5b5bf0" stop-opacity="0"/></linearGradient></defs>${guides}<path d="M${points.join(' L')} L${right},${bottom} L${left},${bottom} Z" fill="url(#performance-fill)"/><polyline points="${points.join(' ')}" fill="none" stroke="#9190ff" stroke-width="2.5" stroke-linejoin="round"/><circle cx="${right}" cy="${y(performance.at(-1))}" r="4" fill="#b8b6ff" stroke="#202039" stroke-width="4"/><text x="20" y="222">15 OCT</text><text x="185" y="222">23 OCT</text><text x="355" y="222">31 OCT</text><text x="495" y="222">07 NOV</text></svg>`;
}
function renderCandles() {
  if (emptyPreview) {
    $('#candlestick-chart').innerHTML = '<div class="chart-empty"><span class="code-mark" aria-hidden="true">—</span><strong>No executions yet</strong><p>A price history will appear after the first trade.</p></div>';
    return;
  }
  const top = 20, bottom = 287, start = 17, step = 21;
  const y = value => bottom - (value - 105) / 9 * (bottom - top);
  const guides = [106, 108, 110, 112, 114].map(value => `<line x1="8" x2="523" y1="${y(value)}" y2="${y(value)}" stroke="#222633" stroke-dasharray="3 5"/><text x="533" y="${y(value) + 4}">${value.toFixed(2)}</text>`).join('');
  const bars = candles.map(([open, high, low, close], index) => {
    const x = start + index * step, color = close >= open ? '#75d8ad' : '#f18d99';
    const bodyTop = Math.min(y(open), y(close)), height = Math.max(2, Math.abs(y(open) - y(close)));
    return `<g><title>Sample candle ${index + 1}: open ${open}, high ${high}, low ${low}, close ${close} EUR</title><line x1="${x}" x2="${x}" y1="${y(high)}" y2="${y(low)}" stroke="${color}"/><rect x="${x - 5}" y="${bodyTop}" width="10" height="${height}" fill="${color}" rx="0"/></g>`;
  }).join('');
  const currentY = y(112.5);
  $('#candlestick-chart').innerHTML = `<svg viewBox="0 0 590 335" role="img" aria-labelledby="candles-title candles-description"><title id="candles-title">Quant Coin candlestick price chart</title><desc id="candles-description">24 fixed sample fifteen-minute candles. First open 106.80 EUR; last close 112.50 EUR. Session high 113.20 and low 106.20 EUR.</desc>${guides}${bars}<line x1="8" x2="523" y1="${currentY}" y2="${currentY}" stroke="#aaa9ff" stroke-opacity=".5" stroke-dasharray="3 4"/><rect x="527" y="${currentY - 10}" width="60" height="20" rx="0" fill="#36334f"/><text x="533" y="${currentY + 4}" style="fill:#dedbff">112.50</text><text x="12" y="325">09:00</text><text x="178" y="325">11:00</text><text x="345" y="325">13:00</text><text x="472" y="325">14:45</text></svg>`;
}
function nearbyRows(period) {
  return period.nearby.map(([name, profit], index) => `<div class="nearby-row ${name === participant.name ? 'is-you' : ''}"><span class="position">${period.rank - 2 + index}</span><span class="mini-avatar" aria-hidden="true">${initials(name)}</span><span>${name}${name === participant.name ? '<span class="you-label">YOU</span>' : ''}</span><span class="positive">${signed(profit)}</span></div>`).join('');
}
function renderLeaderboard(key = 'continuous') {
  const period = periods[key];
  all('[data-period]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.period === key)));
  $('#leader-rank').innerHTML = `#${period.rank} <small>/ 142</small>`;
  $('#leader-return').textContent = signed(period.profit);
  $('#ranking-title').textContent = 'Leaderboard';
  $('#leader-nearby').innerHTML = nearbyRows(period);
  const row = (rank, name, profit) => `<tr class="${name === participant.name ? 'is-you' : ''}"><td class="${rank <= 3 ? 'top-rank' : 'muted'}">${String(rank).padStart(2, '0')}</td><td><span class="participant-cell"><span class="mini-avatar" aria-hidden="true">${initials(name)}</span><span>${name}${name === participant.name ? '<span class="you-label">YOU</span>' : ''}</span></span></td><td class="positive">${signed(profit)}</td></tr>`;
  const seen = new Set();
  let rows = period.leaders.map(([name, profit], index) => { seen.add(name); return row(index + 1, name, profit); }).join('');
  if (period.rank - 2 > 6) rows += '<tr class="gap-row"><td colspan="3" aria-label="Other participants omitted">···</td></tr>';
  rows += period.nearby.map(([name, profit], index) => seen.has(name) ? '' : row(period.rank - 2 + index, name, profit)).join('');
  $('#leaderboard-body').innerHTML = rows;
  if (emptyPreview) {
    $('#leader-rank').textContent = '—';
    $('#leader-return').textContent = '—';
    $('#leader-nearby').innerHTML = '<div class="chart-empty"><strong>No standings yet</strong></div>';
    $('#leaderboard-body').innerHTML = '<tr><td class="empty-cell" colspan="3">Awaiting the first ranking snapshot.</td></tr>';
  }
}
function renderBook() {
  for (const [side, selector] of [['asks', '#asks'], ['bids', '#bids']]) {
    let cumulative = 0;
    const quotes = demo.state.book[side].map(([price, size]) => ({ price, size, total: cumulative += size }));
    const max = Math.max(1, cumulative);
    if (side === 'asks') quotes.reverse();
    $(selector).innerHTML = quotes.map(({ price, size, total }) => `<tr style="--depth:${total / max * 100}%"><td class="${side === 'asks' ? 'negative' : 'positive'}">${money(price)}</td><td>${number(size)}</td><td class="muted">${number(total)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty-cell">No sample liquidity</td></tr>';
  }
  const ask = demo.state.book.asks[0]?.[0], bid = demo.state.book.bids[0]?.[0];
  $('#book-mid').innerHTML = ask != null && bid != null ? `${money((ask + bid) / 2)} <small>EUR</small>` : '—';
  $('#book-spread').textContent = ask != null && bid != null ? `Spread ${money(ask - bid)}` : 'Spread unavailable';
}
function renderAccountValues() {
  const available = demo.available();
  const value = demo.state.cash + demo.state.holdings * snapshot.price;
  const profit = value - snapshot.baseline;
  $('[data-value="total"]').innerHTML = `${money(value)} <small>EUR</small>`;
  $('[data-value="cash"]').innerHTML = `${money(available.cash)} <small>EUR</small>`;
  $('[data-value="reserved"]').textContent = `${money(demo.state.cash - available.cash)} EUR reserved in orders`;
  $('[data-value="holdings"]').innerHTML = `${number(demo.state.holdings)} <small>QC</small>`;
  $('[data-value="holding-value"]').textContent = emptyPreview ? 'No market valuation yet' : `${money(demo.state.holdings * snapshot.price)} EUR at 112.50 EUR / QC`;
  const profitElement = $('[data-value="profit"]');
  profitElement.innerHTML = `${profit >= 0 ? '+' : '−'}${money(Math.abs(profit))} <small>EUR</small>`;
  profitElement.classList.toggle('positive', profit >= 0);
  profitElement.classList.toggle('negative', profit < 0);
  const percentElement = $('[data-value="profit-percent"]');
  percentElement.textContent = `${signed(profit / snapshot.baseline * 100)} since joining`;
  percentElement.classList.toggle('positive', profit >= 0);
  percentElement.classList.toggle('negative', profit < 0);
  renderTicket();
}
function renderTicket() {
  const side = $('input[name="side"]:checked').value;
  const buy = side === 'buy', available = demo.available();
  $('#available-label').textContent = buy ? 'Available cash' : 'Available holdings';
  $('#ticket-available').textContent = buy ? `${money(available.cash)} EUR` : `${number(available.holdings)} QC`;
  const estimate = Number($('#limit-price').value) * Number($('#quantity').value);
  $('#order-value').textContent = Number.isFinite(estimate) && estimate >= 0 ? `${money(Math.round(estimate * 100))} EUR` : '—';
  $('#submit-order').innerHTML = `Place limit ${side} <span aria-hidden="true">↗</span>`;
  $('#submit-order').classList.toggle('sell-button', !buy);
}
function renderOrders() {
  const open = demo.state.orders.filter(order => order.status === 'Open').length;
  $('#open-count').textContent = `${open} open`;
  $('#orders-body').innerHTML = demo.state.orders.map(order => `<tr><td>${order.id}</td><td class="${order.side === 'buy' ? 'positive' : 'negative'}">${order.side === 'buy' ? 'Buy' : 'Sell'}</td><td>${money(order.price)}</td><td>${order.remaining} <span class="muted">/ ${order.quantity}</span></td><td><span class="order-status ${order.status.toLowerCase()}">${order.status}</span></td><td>${order.status === 'Open' ? `<button class="cancel-button" type="button" data-cancel="${order.id}" aria-label="Cancel order ${order.id}">Cancel</button>` : '<span class="muted">—</span>'}</td></tr>`).join('') || '<tr><td class="empty-cell" colspan="6">No orders yet. Your submitted orders will appear here.</td></tr>';
  $('#fills-body').innerHTML = demo.state.fills.map(fill => `<tr><td class="muted">${fill.time}</td><td class="${fill.side === 'buy' ? 'positive' : 'negative'}">${fill.side === 'buy' ? 'Buy' : 'Sell'}</td><td>${money(fill.price)}</td><td>${number(fill.quantity)}</td></tr>`).join('') || '<tr><td class="empty-cell" colspan="4">No fills yet. Open orders have not executed.</td></tr>';
}
function feedback(selector, result) {
  const element = $(selector);
  element.classList.toggle('is-error', Boolean(result.error));
  element.textContent = result.error || result.message;
}
function clearOrderError() {
  for (const [field, selector] of [['price', '#limit-price'], ['quantity', '#quantity']]) {
    $(`#${field}-error`).textContent = '';
    $(selector).removeAttribute('aria-invalid');
  }
}
function renderCredentials() {
  const active = demo.state.credential != null;
  $('#credential').value = demo.state.credential || 'No active sample key';
  $('#copy-key').disabled = !active;
  $('#create-key').disabled = active;
  $('#revoke-key').disabled = !active;
  $('#credential-status').textContent = active ? 'Sample · active' : 'Sample · revoked';
  $('#credential-status').classList.toggle('positive', active);
}
function navigate(focus = false) {
  const [requested, anchor] = location.hash.slice(1).split('/');
  const view = ['overview', 'trade', 'leaderboard', 'account'].includes(requested) ? requested : 'overview';
  document.body.dataset.activeView = view;
  all('[data-view]').forEach(section => { section.hidden = section.dataset.view !== view; });
  all('[data-nav]').forEach(link => {
    if (link.dataset.nav === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const name = view === 'account' ? 'API / Account' : view[0].toUpperCase() + view.slice(1);
  document.title = `${name} · PQC Trading`;
  if (focus) {
    if (anchor === 'api-docs' && view === 'account') {
      $('#api-docs').focus({ preventScroll: true });
      $('#api-docs').scrollIntoView({ block: 'center' });
    } else {
      window.scrollTo({ top: 0, behavior: 'instant' });
      const heading = $(`[data-view="${view}"] h1`);
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  }
}

$('#order-form').addEventListener('submit', event => {
  event.preventDefault();
  clearOrderError();
  const result = demo.submit(Object.fromEntries(new FormData(event.currentTarget)));
  if (result.error) {
    if (result.field === 'price' || result.field === 'quantity') {
      const input = result.field === 'price' ? $('#limit-price') : $('#quantity');
      $(`#${result.field}-error`).textContent = result.error;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    }
  } else {
    renderAccountValues(); renderOrders(); renderBook();
    if (demo.state.fills[0] && demo.state.fills[0].id !== 'F-0831') $('#last-price').innerHTML = `${money(demo.state.fills[0].price)} <small>EUR</small>`;
  }
  feedback('#order-feedback', result);
});
$('#order-form').addEventListener('input', () => { clearOrderError(); $('#order-feedback').textContent = ''; renderTicket(); });
$('#orders-body').addEventListener('click', event => {
  const button = event.target.closest('[data-cancel]');
  if (!button) return;
  const result = demo.cancel(button.dataset.cancel);
  feedback('#order-feedback', result);
  renderOrders(); renderAccountValues();
  // Rendering removes the cancelled button; move focus to the next useful control.
  ($('#orders-body [data-cancel]') || $('#submit-order')).focus({ preventScroll: true });
});
all('[data-period]').forEach(button => button.addEventListener('click', () => {
  renderLeaderboard(button.dataset.period);
  $('#period-feedback').textContent = emptyPreview ? 'Awaiting the first ranking snapshot.' : `${periods[button.dataset.period].label} standings shown. Your sample rank is ${periods[button.dataset.period].rank}.`;
}));
$('#copy-key').addEventListener('click', async () => {
  if (!demo.state.credential) return;
  try {
    await navigator.clipboard.writeText(demo.state.credential);
    feedback('#credential-feedback', { message: 'Sample key copied.' });
  } catch {
    $('#credential').focus(); $('#credential').select();
    feedback('#credential-feedback', { error: 'Clipboard unavailable. The sample key is selected; copy it manually.' });
  }
});
$('#create-key').addEventListener('click', () => {
  feedback('#credential-feedback', demo.createCredential()); renderCredentials(); $('#copy-key').focus();
});
$('#revoke-key').addEventListener('click', () => {
  feedback('#credential-feedback', demo.revokeCredential()); renderCredentials(); $('#create-key').focus();
});
window.addEventListener('hashchange', () => navigate(true));

if (emptyPreview) {
  demo.state.orders = [];
  demo.state.fills = [];
  demo.state.book = { asks: [], bids: [] };
  demo.state.cash = snapshot.baseline;
  demo.state.holdings = 0;
  $('#last-price').innerHTML = '— <small>No trades yet</small>';
  $('.market-strip .positive').textContent = '—';
  const stripGroups = all('.market-strip > div');
  stripGroups[3].querySelector('strong').textContent = '— / —';
  stripGroups[4].querySelector('strong').textContent = '—';
}
renderPerformance(); renderCandles(); renderAccountValues(); renderBook(); renderOrders(); renderCredentials();
$('#overview-nearby').innerHTML = nearbyRows(periods.continuous);
renderLeaderboard(); navigate();
if (emptyPreview) {
  $('.chart-summary').innerHTML = '<strong>—</strong>';
  $('.rank-number').textContent = '—';
  $('.rank-return strong').textContent = '—';
  $('#overview-nearby').innerHTML = '<div class="chart-empty"><strong>No standings yet</strong><p>Awaiting the first ranking snapshot.</p></div>';
  $('.market-card-price').innerHTML = '<strong>—</strong><span class="small muted">No executions yet</span>';
}
