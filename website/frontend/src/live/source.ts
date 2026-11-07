/**
 * @implemented-ui Live TradingSource backed by the exchange through the same-origin proxy.
 * One LiveSession per app; sockets open on mount and close on unmount.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { TradingSource } from '../trading/types.ts';
import { createRest } from './rest.ts';
import type { SocketLike } from './session.ts';
import { LiveSession } from './session.ts';

const BASE = '/exchange';

function socketUrl() {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}${BASE}/ws`;
}

export function createBrowserSession() {
  return new LiveSession({
    rest: createRest(BASE),
    openSocket: () => new WebSocket(socketUrl()) as unknown as SocketLike,
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
    random: Math.random,
    randomBytes: (bytes) => crypto.getRandomValues(bytes),
  });
}

export function useLiveSource(): TradingSource {
  const [session] = useState(createBrowserSession);
  useEffect(() => {
    session.start();
    return () => session.stop();
  }, [session]);
  const view = useSyncExternalStore(session.subscribe, session.getView);
  return {
    kind: 'live',
    identity: view.identity,
    market: view.market,
    account: view.account,
    notice: view.notice,
    trading: {
      busy: view.commands.busy,
      unresolved: view.commands.unresolved,
      feedback: view.commands.feedback,
      checkUnresolved: session.checkUnresolved,
      dismissUnresolved: view.commands.canDismiss
        ? session.dismissUnresolved
        : null,
      clearFeedback: session.clearFeedback,
      submit: session.submit,
      cancel: session.cancel,
    },
    session: {
      connect: (token) => session.connect(token),
      disconnect: () => session.disconnect(),
    },
    samples: null,
  };
}
