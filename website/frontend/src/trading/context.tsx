/**
 * @implemented-ui Installs one TradingSource for the whole app.
 * The source hook is chosen once at the root (mock or live) and never switches.
 */
import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';
import type { TradingSource } from './types.ts';

const TradingContext = createContext<TradingSource | null>(null);

export function TradingProvider({
  useSource,
  children,
}: {
  useSource: () => TradingSource;
  children: ReactNode;
}) {
  const source = useSource();
  return (
    <TradingContext.Provider value={source}>{children}</TradingContext.Provider>
  );
}

export function useTrading(): TradingSource {
  const source = useContext(TradingContext);
  if (!source) throw new Error('TradingProvider is missing');
  return source;
}
