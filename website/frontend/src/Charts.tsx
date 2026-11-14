/**
 * Accessible SVG charts.
 * @implemented-ui Candle chart renders any supplied candles with computed scales,
 *   time labels, and a last-price marker; empty-state rendering.
 * @implemented-ui Performance chart computes scale and dates from a live series.
 * @mock-frontend The sample performance series keeps its fixed scale, dates and description.
 */
import { cx } from './styles';
import { useTrading } from './trading/context.tsx';
import { scaleOf, toNumber } from './trading/decimal.ts';
import type { Chart } from './trading/types.ts';

/** @implemented-ui Reusable empty-state renderer. */
export function EmptyChart({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className={cx('chart-empty')}>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
const DAY = 24 * 60 * 60 * 1000;
const dayLabel = (epoch: number) =>
  new Date(epoch)
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
    .toUpperCase();

/** Round grid steps (1, 2, 5 × 10^n) covering the value range. */
function grid(low: number, high: number) {
  const span = Math.max(high - low, Math.abs(high) * 0.01, 1);
  const raw = span / 3;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw;
  const first = Math.floor(low / step) * step;
  const lines: number[] = [];
  for (let value = first; value <= high + step * 0.01; value += step)
    lines.push(value);
  if (lines.length < 2) lines.push(first + step);
  return lines;
}

const compact = (value: number) =>
  Math.abs(value) >= 10_000
    ? `${Number((value / 1000).toFixed(1))}k`
    : Number(value.toFixed(2)).toString();

/**
 * @implemented-ui SVG rendering of account value history.
 * With `times` (live), scale, grid and dates are computed from the series.
 * @mock-frontend Without `times`, the fixed sample scale, dates and description apply.
 */
export function PerformanceChart({
  series,
  times = null,
}: {
  series: number[];
  times?: number[] | null;
}) {
  const left = 20,
    right = 545,
    top = 22,
    bottom = 195;
  const live = times != null && times.length === series.length;
  const lines = live
    ? grid(Math.min(...series), Math.max(...series))
    : [100000, 110000, 120000, 130000];
  const low = live ? (lines[0] ?? 0) : 95000;
  const high = live ? (lines.at(-1) ?? 1) : 140000;
  const y = (value: number) =>
    bottom - ((value - low) / (high - low || 1)) * (bottom - top);
  const x = (index: number) =>
    series.length < 2
      ? right
      : left + (index / (series.length - 1)) * (right - left);
  const points = series.map((value, index) => `${x(index)},${y(value)}`);
  const first = times?.[0] ?? 0;
  const last = times?.at(-1) ?? 0;
  const dates = live
    ? last - first < DAY
      ? [first, last].map((epoch) =>
          new Date(epoch).toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
          }),
        )
      : [0, 1, 2, 3].map((part) =>
          dayLabel(first + ((last - first) * part) / 3),
        )
    : ['15 OCT', '23 OCT', '31 OCT', '07 NOV'];
  const description = live
    ? `Account value from ${compact(series[0] ?? 0)} to ${compact(series.at(-1) ?? 0)} between ${dayLabel(first)} and ${dayLabel(last)}, sampled every 10 minutes.`
    : 'Fixed sample history rises from 100,000 EUR to 130,450 EUR between 15 October and 7 November 2026. This is illustrative, not live performance.';
  return (
    <svg
      viewBox="0 0 610 230"
      role="img"
      aria-labelledby="performance-svg-title performance-svg-description"
    >
      <title id="performance-svg-title">Personal account value</title>
      <desc id="performance-svg-description">{description}</desc>
      <defs>
        <linearGradient id="performance-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5b5bf0" stopOpacity=".25" />
          <stop offset="100%" stopColor="#5b5bf0" stopOpacity="0" />
        </linearGradient>
      </defs>
      {lines.map((value) => (
        <g key={value}>
          <line
            x1={left}
            x2={right}
            y1={y(value)}
            y2={y(value)}
            stroke="#252936"
            strokeDasharray="3 5"
          />
          <text x="558" y={y(value) + 4}>
            {live ? compact(value) : `${value / 1000}k`}
          </text>
        </g>
      ))}
      <path
        d={`M${points.join(' L')} L${right},${bottom} L${x(0)},${bottom} Z`}
        fill="url(#performance-fill)"
      />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="#9190ff"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <circle
        cx={right}
        cy={y(series.at(-1) ?? 0)}
        r="4"
        fill="#b8b6ff"
        stroke="#202039"
        strokeWidth="4"
      />
      {dates.map((label, index) => (
        <text
          key={label + String(index)}
          x={dates.length === 2 ? [20, 495][index] : [20, 185, 355, 495][index]}
          y="222"
        >
          {label}
        </text>
      ))}
    </svg>
  );
}

/** Human label for a candle interval, e.g. "15 min". */
export function intervalLabel(interval: number) {
  const minutes = Math.round(interval / 60000);
  return minutes >= 60 && minutes % 60 === 0
    ? `${minutes / 60} h`
    : `${minutes} min`;
}
const time = (epoch: number) =>
  new Date(epoch).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });

/** A "nice" tick step (1, 2, 2.5, 5 × 10^k) giving roughly four intervals. */
function niceStep(range: number) {
  const raw = range / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const factor = [1, 2, 2.5, 5, 10].find((f) => f * power >= raw) ?? 10;
  return factor * power;
}

/** @implemented-ui Candles from the active source with computed scales and labels. */
export function CandleChart({ chart }: { chart: Chart }) {
  const { market } = useTrading();
  const { candles, interval } = chart;
  const first = candles[0];
  const latest = candles.at(-1);
  if (!first || !latest)
    return (
      <EmptyChart
        title="No executions yet"
        description="A price history will appear after the first trade."
      />
    );
  const decimals = market.instrument
    ? scaleOf(market.instrument.priceIncrement)
    : 2;
  const high = Math.max(...candles.map((candle) => toNumber(candle.high)));
  const low = Math.min(...candles.map((candle) => toNumber(candle.low)));
  const span = high - low || Math.max(high * 0.02, 10 ** -decimals * 10);
  const step = niceStep(span);
  const minimum = Math.floor(low / step) * step - step / 2;
  let maximum = Math.ceil(high / step) * step;
  if (maximum <= high) maximum += step / 2;
  const ticks: number[] = [];
  for (
    let tick = Math.ceil(minimum / step) * step;
    tick <= maximum;
    tick += step
  )
    ticks.push(Number(tick.toFixed(10)));
  const top = 20,
    bottom = 287,
    left = 8,
    right = 523;
  const y = (value: number) =>
    bottom - ((value - minimum) / (maximum - minimum)) * (bottom - top);
  const slot = Math.min(21, (right - left) / candles.length);
  const body = Math.max(2, Math.min(10, slot * 0.5));
  const x = (index: number) => left + slot * (index + 0.5);
  const current = toNumber(market.lastPrice ?? latest.close);
  const currentY = y(current);
  const labels = [
    ...new Set([
      0,
      Math.ceil((candles.length - 1) / 3),
      Math.ceil(((candles.length - 1) * 2) / 3),
      candles.length - 1,
    ]),
  ];
  const fixed = (value: number) => value.toFixed(decimals);
  const asset =
    market.instrument?.baseName ?? market.instrument?.baseAsset ?? 'Market';
  return (
    <svg
      viewBox="0 0 590 335"
      role="img"
      aria-labelledby="candles-title candles-description"
    >
      <title id="candles-title">{`${asset} candlestick price chart`}</title>
      <desc id="candles-description">
        {`${candles.length} ${intervalLabel(interval)} candles. First open ${first.open}; last close ${latest.close}. High ${fixed(high)} and low ${fixed(low)}.`}
      </desc>
      {ticks.map((value) => (
        <g key={value}>
          <line
            x1={left}
            x2={right}
            y1={y(value)}
            y2={y(value)}
            stroke="#222633"
            strokeDasharray="3 5"
          />
          <text x="533" y={y(value) + 4}>
            {fixed(value)}
          </text>
        </g>
      ))}
      {candles.map((candle, index) => {
        const open = toNumber(candle.open),
          close = toNumber(candle.close),
          color = close >= open ? '#75d8ad' : '#f18d99';
        return (
          <g key={candle.start}>
            <title>
              {`${time(candle.start)}: open ${candle.open}, high ${candle.high}, low ${candle.low}, close ${candle.close}`}
            </title>
            <line
              x1={x(index)}
              x2={x(index)}
              y1={y(toNumber(candle.high))}
              y2={y(toNumber(candle.low))}
              stroke={color}
            />
            <rect
              x={x(index) - body / 2}
              y={Math.min(y(open), y(close))}
              width={body}
              height={Math.max(2, Math.abs(y(open) - y(close)))}
              fill={color}
            />
          </g>
        );
      })}
      <line
        x1={left}
        x2={right}
        y1={currentY}
        y2={currentY}
        stroke="#aaa9ff"
        strokeOpacity=".5"
        strokeDasharray="3 4"
      />
      <rect x="527" y={currentY - 10} width="60" height="20" fill="#36334f" />
      <text x="533" y={currentY + 4} style={{ fill: '#dedbff' }}>
        {fixed(current)}
      </text>
      {labels.map((index) => (
        <text key={index} x={Math.min(Math.max(x(index) - 15, 4), 490)} y="325">
          {time((candles[index] ?? latest).start)}
        </text>
      ))}
    </svg>
  );
}
