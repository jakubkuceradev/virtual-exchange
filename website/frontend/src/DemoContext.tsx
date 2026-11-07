import type { ReactNode } from 'react';
import { createContext, useContext, useState } from 'react';
import type { Feedback } from './demo.ts';
import { createDemo } from './demo.ts';

function useSession() {
  const [empty] = useState(
    () => new URLSearchParams(location.search).get('scenario') === 'no-trades',
  );
  const [demo] = useState(() => createDemo(empty));
  const [state, setState] = useState(() => structuredClone(demo.state));
  const [orderFeedback, setOrderFeedback] = useState<Feedback | null>(null);
  function run<T>(command: () => T): T {
    const result = command();
    setState(structuredClone(demo.state));
    return result;
  }
  return {
    state,
    empty,
    orderFeedback,
    clearOrderFeedback: () => setOrderFeedback(null),
    available: demo.available(),
    submit: (input: Parameters<typeof demo.submit>[0]) => {
      const result = run(() => demo.submit(input));
      setOrderFeedback(result);
      return result;
    },
    cancel: (id: string) => {
      const result = run(() => demo.cancel(id));
      setOrderFeedback(result);
      return result;
    },
    createCredential: () => run(() => demo.createCredential()),
    revokeCredential: () => run(() => demo.revokeCredential()),
  };
}
const DemoContext = createContext<ReturnType<typeof useSession> | null>(null);
export function DemoProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  return (
    <DemoContext.Provider value={session}>{children}</DemoContext.Provider>
  );
}
export function useDemo() {
  const demo = useContext(DemoContext);
  if (!demo) throw new Error('DemoProvider is missing');
  return demo;
}
