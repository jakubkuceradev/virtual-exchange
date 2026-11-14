/**
 * @implemented-ui Installs one TradingSource for the whole app.
 * The source hook is chosen once at the root (mock or live) and never switches.
 *
 * Components subscribe to the slices they display with `useSource(select)`.
 * The context value is a stable store, so a new source never re-renders the
 * tree by itself; a component re-renders only when its selected value changes
 * identity. Selectors must return values already present in the source (or
 * primitives), never newly built objects.
 */
import type { ReactNode } from 'react';
import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import type { TradingSource } from './types.ts';

class SourceStore {
  current: TradingSource;
  private readonly listeners = new Set<() => void>();
  constructor(source: TradingSource) {
    this.current = source;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  publish(source: TradingSource) {
    if (source === this.current) return;
    this.current = source;
    for (const listener of this.listeners) listener();
  }
}

const SourceContext = createContext<SourceStore | null>(null);

export function TradingProvider({
  useSource: useActiveSource,
  children,
}: {
  useSource: () => TradingSource;
  children: ReactNode;
}) {
  const source = useActiveSource();
  const [store] = useState(() => new SourceStore(source));
  // Children are a stable element, so this render reaches them only through
  // the store's subscribers.
  useLayoutEffect(() => store.publish(source), [store, source]);
  return (
    <SourceContext.Provider value={store}>{children}</SourceContext.Provider>
  );
}

/** Subscribe to one slice of the active source. */
export function useSource<T>(select: (source: TradingSource) => T): T {
  const store = useContext(SourceContext);
  if (!store) throw new Error('TradingProvider is missing');
  return useSyncExternalStore(store.subscribe, () => select(store.current));
}
