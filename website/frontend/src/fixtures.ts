/**
 * MOCK DATA ONLY — every observation and identity below is fabricated.
 * @mock-backend Account identity, cash/holdings, market depth/history, and competition observations.
 * @mock-frontend Valuation baseline, fixed dates, ranking samples, and instrument conventions preserve the visual.
 * Replace with published API records; these local types are not transport contracts.
 */
export type Book = { asks: [number, number][]; bids: [number, number][] };
export type Period = 'continuous' | 'weekly' | 'monthly' | 'yearly';
export type Standings = {
  label: string;
  range: string;
  rank: number;
  profit: number;
  leaders: [string, number][];
  nearby: [string, number][];
};
// Illustrative observations only. These fixtures establish no competition policy.
export const participant = {
  name: 'Alex Morgan',
  id: 'acct_demo_0142',
  initials: 'AM',
};
export const snapshot = {
  cash: 7645000,
  holdings: 480,
  price: 11250,
  baseline: 10000000,
};
export const performance = [
  100000, 101800, 100900, 105200, 104100, 106500, 105900, 109800, 108400,
  111200, 110100, 114500, 113200, 117600, 115900, 119300, 118200, 122100,
  120700, 124600, 123500, 126100, 125300, 130450,
];
export const candles: [number, number, number, number][] = [
  [106.8, 108.1, 106.2, 107.6],
  [107.6, 108, 106.8, 107.1],
  [107.1, 108.8, 107, 108.4],
  [108.4, 109.3, 108.1, 108.9],
  [108.9, 109.2, 107.7, 108.1],
  [108.1, 108.7, 107.8, 108.5],
  [108.5, 110.1, 108.2, 109.8],
  [109.8, 110.5, 109.2, 110.2],
  [110.2, 110.6, 109.1, 109.5],
  [109.5, 110.2, 109, 109.9],
  [109.9, 111.2, 109.7, 110.8],
  [110.8, 111.6, 110.1, 111.3],
  [111.3, 111.8, 110.4, 110.7],
  [110.7, 111.3, 110.3, 111.1],
  [111.1, 112.3, 110.9, 111.9],
  [111.9, 112.6, 111.5, 112.2],
  [112.2, 112.5, 111.2, 111.6],
  [111.6, 112.2, 111.1, 111.9],
  [111.9, 112.8, 111.7, 112.4],
  [112.4, 113.1, 112, 112.8],
  [112.8, 113.2, 111.8, 112.1],
  [112.1, 112.7, 111.9, 112.5],
  [112.5, 113.1, 112.2, 112.8],
  [112.8, 113, 112.1, 112.5],
];
export const initialBook: Book = {
  asks: [
    [11260, 6],
    [11280, 24],
    [11300, 42],
    [11320, 65],
    [11340, 38],
    [11360, 94],
  ],
  bids: [
    [11240, 8],
    [11220, 32],
    [11200, 58],
    [11180, 41],
    [11160, 86],
    [11140, 120],
  ],
};
const leaders: [string, number][] = [
  ['delta.neutral', 54.82],
  ['mean_reverter', 49.37],
  ['Nina K.', 46.9],
  ['random.walk', 42.15],
  ['Tomáš V.', 39.68],
];
export const periods: Record<Period, Standings> = {
  continuous: {
    label: 'Continuous',
    range: 'Since joining',
    rank: 12,
    profit: 30.45,
    leaders,
    nearby: [
      ['Lena S.', 31.91],
      ['martingale', 31.12],
      ['Alex Morgan', 30.45],
      ['noise.trader', 29.8],
      ['Emma R.', 28.64],
    ],
  },
  weekly: {
    label: 'Weekly',
    range: 'This week',
    rank: 7,
    profit: 4.81,
    leaders: [
      ['Nina K.', 8.92],
      ['delta.neutral', 7.64],
      ['Emma R.', 6.7],
      ['random.walk', 6.22],
      ['Lena S.', 5.93],
    ],
    nearby: [
      ['Lena S.', 5.93],
      ['Tomáš V.', 5.12],
      ['Alex Morgan', 4.81],
      ['mean_reverter', 4.23],
      ['noise.trader', 3.91],
    ],
  },
  monthly: {
    label: 'Monthly',
    range: 'This month',
    rank: 18,
    profit: 9.24,
    leaders: [
      ['mean_reverter', 21.42],
      ['random.walk', 19.82],
      ['Tomáš V.', 18.71],
      ['Nina K.', 17.64],
      ['delta.neutral', 16.33],
    ],
    nearby: [
      ['Emma R.', 10.18],
      ['Lena S.', 9.81],
      ['Alex Morgan', 9.24],
      ['noise.trader', 8.92],
      ['martingale', 8.15],
    ],
  },
  yearly: {
    label: 'Yearly',
    range: 'This year',
    rank: 9,
    profit: 28.16,
    leaders: [
      ['delta.neutral', 51.09],
      ['Nina K.', 46.81],
      ['mean_reverter', 43.25],
      ['Tomáš V.', 39.26],
      ['random.walk', 36.87],
    ],
    nearby: [
      ['martingale', 29.91],
      ['Lena S.', 28.73],
      ['Alex Morgan', 28.16],
      ['Emma R.', 27.84],
      ['noise.trader', 26.19],
    ],
  },
};
