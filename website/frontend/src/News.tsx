/**
 * News view over the active TradingSource.
 * @implemented-ui Live feed newest first with publication time, instrument tags,
 *   body, and announced event time with a countdown. Public: no token needed.
 */
import { useEffect, useState } from 'react';
import { countdown, newsTime } from './news-format.ts';
import { cx } from './styles';
import { useTrading } from './trading/context.tsx';
import type { NewsItem, NewsView } from './trading/types.ts';

/** Current time, ticking each second only while `enabled`. */
function useNow(enabled: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return now;
}

const STATUS: Record<NewsView['status'], string> = {
  connecting: 'Loading news…',
  ready: 'Live',
  stale: 'Reconnecting…',
  unavailable: 'News unavailable. Retrying…',
};

function Event({ at, now }: { at: number; now: number }) {
  const remaining = countdown(at, now);
  return (
    <p className={cx('news-event', remaining != null && 'upcoming')}>
      <span className={cx('label')}>{'EVENT'}</span>{' '}
      <time dateTime={new Date(at).toISOString()}>{newsTime(at, now)}</time>
      {' · '}
      <span data-countdown>{remaining ?? 'Event time passed'}</span>
    </p>
  );
}

function Item({ item, now }: { item: NewsItem; now: number }) {
  return (
    <li className={cx('news-item')} data-news-id={item.id}>
      <div className={cx('news-meta')}>
        <time dateTime={new Date(item.publishedAt).toISOString()}>
          {newsTime(item.publishedAt, now)}
        </time>
        {item.instrumentIds.map((id) => (
          <span key={id} className={cx('news-tag')}>
            {id}
          </span>
        ))}
      </div>
      <h3>{item.headline}</h3>
      {item.body && <p className={cx('news-body')}>{item.body}</p>}
      {item.eventAt != null && <Event at={item.eventAt} now={now} />}
    </li>
  );
}

/** @implemented-ui Public news feed from the source. */
export function News({ active }: { active: boolean }) {
  const { news } = useTrading();
  const upcoming = news.items.some(
    (item) => item.eventAt != null && item.eventAt > Date.now(),
  );
  const now = useNow(active && upcoming);
  return (
    <section data-view="news" aria-labelledby="news-title" hidden={!active}>
      <h1 id="news-title" className={cx('sr-only')} tabIndex={-1}>
        {'News'}
      </h1>
      <article className={cx('panel news-panel')}>
        <div className={cx('panel-heading')}>
          <div>
            <p className={cx('eyebrow')}>{'MARKET WIRE'}</p>
            <h2>{'News'}</h2>
          </div>
          <span
            id="news-status"
            className={cx('meta-label', news.status === 'ready' && 'positive')}
            role="status"
          >
            {STATUS[news.status]}
          </span>
        </div>
        {news.items.length ? (
          <ol id="news-list" className={cx('news-list')} aria-live="polite">
            {news.items.map((item) => (
              <Item key={item.id} item={item} now={now} />
            ))}
          </ol>
        ) : (
          <p id="news-empty" className={cx('news-empty')}>
            {news.status === 'ready'
              ? 'No news yet. New items appear here as they are published.'
              : STATUS[news.status]}
          </p>
        )}
        <div className={cx('panel-foot')}>
          <span>{'Newest first · updates live'}</span>
          <span>{`${news.items.length} ${news.items.length === 1 ? 'item' : 'items'}`}</span>
        </div>
      </article>
    </section>
  );
}
