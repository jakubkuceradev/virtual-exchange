/**
 * Chart rendering works; observations and chart metadata are visual mocks.
 * @mock-backend Performance/candle series and missing-observation scenario come from fixtures.
 * @mock-frontend Fixed scales, current-price marker, dates, intervals, and descriptions match sample series.
 * @implemented-ui Accessible React SVG and empty-state rendering.
 * Replace series plus scales/labels/descriptions together; these are not live charts.
 */
import { useDemo } from './DemoContext';
import { candles, performance } from './fixtures.ts';
import { cx } from './styles';

/** @implemented-ui Reusable empty-state renderer; its caller currently supplies a demo availability state. */
function EmptyChart({
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
/** @mock-backend Fixed account history. @mock-frontend Scale, dates, and descriptive text. @implemented-ui SVG rendering. */
export function PerformanceChart() {
  const { empty } = useDemo();
  if (empty)
    return (
      <EmptyChart
        title="No performance history yet"
        description="Your account history will appear here."
      />
    );
  const left = 20,
    right = 545,
    top = 22,
    bottom = 195;
  const y = (value: number) =>
    bottom - ((value - 95000) / 45000) * (bottom - top);
  const points = performance.map(
    (value, index) =>
      `${left + (index / (performance.length - 1)) * (right - left)},${y(value)}`,
  );
  return (
    <svg
      viewBox="0 0 610 230"
      role="img"
      aria-labelledby="performance-svg-title performance-svg-description"
    >
      <title id="performance-svg-title">Personal account value</title>
      <desc id="performance-svg-description">
        Fixed sample history rises from 100,000 EUR to 130,450 EUR between 15
        October and 7 November 2026. This is illustrative, not live performance.
      </desc>
      <defs>
        <linearGradient id="performance-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5b5bf0" stopOpacity=".25" />
          <stop offset="100%" stopColor="#5b5bf0" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[100000, 110000, 120000, 130000].map((value) => (
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
            {value / 1000}k
          </text>
        </g>
      ))}
      <path
        d={`M${points.join(' L')} L${right},${bottom} L${left},${bottom} Z`}
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
        cy={y(performance.at(-1) ?? 130450)}
        r="4"
        fill="#b8b6ff"
        stroke="#202039"
        strokeWidth="4"
      />
      <text x="20" y="222">
        15 OCT
      </text>
      <text x="185" y="222">
        23 OCT
      </text>
      <text x="355" y="222">
        31 OCT
      </text>
      <text x="495" y="222">
        07 NOV
      </text>
    </svg>
  );
}
/** @mock-backend Fixed candle history. @mock-frontend Scale, times, and price marker. @implemented-ui SVG rendering. */
export function CandleChart() {
  const { empty } = useDemo();
  if (empty)
    return (
      <EmptyChart
        title="No executions yet"
        description="A price history will appear after the first trade."
      />
    );
  const top = 20,
    bottom = 287;
  const y = (value: number) => bottom - ((value - 105) / 9) * (bottom - top);
  const currentY = y(112.5);
  return (
    <svg
      viewBox="0 0 590 335"
      role="img"
      aria-labelledby="candles-title candles-description"
    >
      <title id="candles-title">Quant Coin candlestick price chart</title>
      <desc id="candles-description">
        24 fixed sample fifteen-minute candles. First open 106.80 EUR; last
        close 112.50 EUR. Session high 113.20 and low 106.20 EUR.
      </desc>
      {[106, 108, 110, 112, 114].map((value) => (
        <g key={value}>
          <line
            x1="8"
            x2="523"
            y1={y(value)}
            y2={y(value)}
            stroke="#222633"
            strokeDasharray="3 5"
          />
          <text x="533" y={y(value) + 4}>
            {value.toFixed(2)}
          </text>
        </g>
      ))}
      {candles.map(([open, high, low, close], index) => {
        const x = 17 + index * 21,
          color = close >= open ? '#75d8ad' : '#f18d99';
        return (
          <g key={`${open}:${high}:${low}:${close}`}>
            <title>
              Sample candle {index + 1}: open {open}, high {high}, low {low},
              close {close} EUR
            </title>
            <line x1={x} x2={x} y1={y(high)} y2={y(low)} stroke={color} />
            <rect
              x={x - 5}
              y={Math.min(y(open), y(close))}
              width="10"
              height={Math.max(2, Math.abs(y(open) - y(close)))}
              fill={color}
            />
          </g>
        );
      })}
      <line
        x1="8"
        x2="523"
        y1={currentY}
        y2={currentY}
        stroke="#aaa9ff"
        strokeOpacity=".5"
        strokeDasharray="3 4"
      />
      <rect x="527" y={currentY - 10} width="60" height="20" fill="#36334f" />
      <text x="533" y={currentY + 4} style={{ fill: '#dedbff' }}>
        112.50
      </text>
      <text x="12" y="325">
        09:00
      </text>
      <text x="178" y="325">
        11:00
      </text>
      <text x="345" y="325">
        13:00
      </text>
      <text x="472" y="325">
        14:45
      </text>
    </svg>
  );
}
