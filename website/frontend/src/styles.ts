/**
 * @implemented-ui CSS Module class composition and display-format helpers.
 * These functions do not fetch, simulate, or mutate account/market data.
 * Locale/formatting presentation can be retained when real API data is connected.
 */
import styles from './App.module.css';
import type { Decimal } from './trading/decimal.ts';
import { format } from './trading/decimal.ts';

export const cx = (...names: (string | false | undefined)[]) =>
  names
    .filter(Boolean)
    .flatMap((name) => String(name).split(' '))
    .map((name) => {
      const className = styles[name];
      if (import.meta.env.DEV && !className)
        console.warn(`Unknown CSS Module class: ${name}`);
      return className;
    })
    .filter(Boolean)
    .join(' ');
/** Cash amount: grouped, at least two decimals, never rounded. */
export const money = (value: Decimal) => format(value, 2);
/** Quantity: grouped, exact digits, never rounded. */
export const number = (value: Decimal) => format(value);
export const signed = (value: number) =>
  `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}%`;
export const initials = (name: string) =>
  name
    .split(/[ ._]+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
