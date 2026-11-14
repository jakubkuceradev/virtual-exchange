/**
 * @implemented-ui Live TradingSource: the exchange through the same-origin
 * /exchange proxy, and competition data from the website backend under /website.
 * One LiveSession and one CompetitionFeed per app; both start on mount.
 * The token stays in memory; the feed sees it only while an identity is known.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { TradingSource } from '../trading/types.ts';
import { CompetitionFeed } from './competition.ts';
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

export function createBrowserFeed() {
  return new CompetitionFeed({
    fetch: (input, init) => fetch(input, init),
    now: Date.now,
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
  });
}

export function useLiveSource(): TradingSource {
  const [session] = useState(createBrowserSession);
  const [feed] = useState(createBrowserFeed);
  const token = useRef<string | null>(null);
  useEffect(() => {
    session.start();
    feed.start();
    return () => {
      session.stop();
      feed.stop();
    };
  }, [session, feed]);
  const view = useSyncExternalStore(session.subscribe, session.getView);
  const competition = useSyncExternalStore(feed.subscribe, feed.getView);
  const accountId = view.identity?.accountId ?? null;
  useEffect(() => {
    feed.setToken(accountId ? token.current : null);
  }, [feed, accountId]);
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
      connect: (value) => {
        token.current = value;
        return session.connect(value);
      },
      disconnect: () => {
        token.current = null;
        feed.setToken(null);
        session.disconnect();
      },
    },
    competition,
    samples: null,
  };
}
