import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Account } from './Account';
import { DemoProvider } from './DemoContext';
import { participant } from './fixtures.ts';
import { Leaderboard } from './Leaderboard';
import { Overview } from './Overview';
import { cx } from './styles';
import { Trade } from './Trade';

const views = ['overview', 'trade', 'leaderboard', 'account'] as const;
function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}
function Dashboard() {
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  const [requested, anchor] = hash.slice(1).split('/');
  const view = views.find((candidate) => candidate === requested) ?? 'overview';
  const visited = useRef(false);
  useEffect(() => {
    document.title = `${view === 'account' ? 'API / Account' : view.charAt(0).toUpperCase() + view.slice(1)} · PQC Trading`;
    if (visited.current || anchor === 'api-docs') {
      const target =
        anchor === 'api-docs' && view === 'account'
          ? document.getElementById('api-docs')
          : document.querySelector<HTMLElement>(`[data-view="${view}"] h1`);
      if (anchor === 'api-docs') target?.scrollIntoView({ block: 'center' });
      else window.scrollTo({ top: 0, behavior: 'instant' });
      target?.focus({ preventScroll: true });
    }
    visited.current = true;
  }, [view, anchor]);
  return (
    <>
      {/* biome-ignore lint/a11y/useValidAnchor: The skip link navigates within the current view without changing the hash route. */}
      <a
        className={cx('skip-link')}
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Skip to content
      </a>
      <header className={cx('site-header')}>
        <a
          href="#overview"
          className={cx('brand')}
          aria-label="PQC Trading overview"
        >
          {'pqc.trading'}
          <span className={cx('accent')}>{'_'}</span>
        </a>
        <nav aria-label="Main navigation">
          <a
            href="#overview"
            data-nav="overview"
            aria-current={view === 'overview' ? 'page' : undefined}
          >
            {'Overview'}
          </a>
          <a
            href="#trade"
            data-nav="trade"
            aria-current={view === 'trade' ? 'page' : undefined}
          >
            {'Trade'}
          </a>
          <a
            href="#leaderboard"
            data-nav="leaderboard"
            aria-current={view === 'leaderboard' ? 'page' : undefined}
          >
            {'Leaderboard'}
          </a>
          <a
            href="#account"
            data-nav="account"
            aria-current={view === 'account' ? 'page' : undefined}
          >
            {'API / Account'}
          </a>
        </nav>
        <a
          href="#account"
          className={cx('identity')}
          aria-label={`${participant.name}, account`}
        >
          <span className={cx('avatar')}>{participant.initials}</span>
          <span className={cx('identity-name')}>{participant.name}</span>
          <span className={cx('muted')} aria-hidden="true">
            {'⌄'}
          </span>
        </a>
      </header>
      <main id="main" tabIndex={-1}>
        <Overview active={view === 'overview'} />
        <Trade active={view === 'trade'} />
        <Leaderboard active={view === 'leaderboard'} />
        <Account active={view === 'account'} />
      </main>
      <footer className={cx('site-footer')}>
        <a className={cx('footer-brand')} href="https://praguequantclub.org/">
          {'Prague Quant Club'}
        </a>
        <nav aria-label="Club social links">
          <a
            href="https://instagram.com/praguequantclub"
            target="_blank"
            rel="noopener"
          >
            {'Instagram'}
          </a>
          <a
            href="https://linkedin.com/company/prague-quant-club"
            target="_blank"
            rel="noopener"
          >
            {'LinkedIn'}
          </a>
        </nav>
      </footer>
    </>
  );
}
export function App() {
  return (
    <DemoProvider>
      <Dashboard />
    </DemoProvider>
  );
}
