/**
 * @implemented-ui CSS Module class composition and display-format helpers.
 * These functions do not fetch, simulate, or mutate account/market data.
 * Locale/formatting presentation can be retained when real API data is connected.
 */
import styles from './App.module.css';

export const cx = (...names: (string | false | undefined)[]) =>
  names
    .filter(Boolean)
    .flatMap((name) => String(name).split(' '))
    .map((name) => styles[name])
    .filter(Boolean)
    .join(' ');
export const money = (cents: number) =>
  (cents / 100).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export const number = (value: number) => value.toLocaleString('en-GB');
export const signed = (value: number) =>
  `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}%`;
export const initials = (name: string) =>
  name
    .split(/[ ._]+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
