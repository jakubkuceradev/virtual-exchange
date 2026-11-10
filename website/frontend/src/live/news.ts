/**
 * @implemented-ui Pure news-feed state built only from exchange observations.
 * Recovery follows the exchange's exact rule: the `news` subscription baseline N
 * is also the `GET /news` high watermark, so the feed is the page fetched at N
 * plus buffered channel items above N. Items are also deduplicated by ID.
 */
import type { NewsItem } from '../trading/types.ts';
import { list, news } from './wire.ts';

/** Newest first. */
export type Feed = readonly NewsItem[];

/** A channel bundle received before the REST page was installed. */
export type Buffered = { sequence: number; payload: unknown };

/** Prepend one channel bundle (a list of items in publication order). */
export function prepend(feed: Feed, payload: unknown): Feed {
  const known = new Set(feed.map((item) => item.id));
  const fresh: NewsItem[] = [];
  for (const item of list(payload, 'news').map(news)) {
    if (known.has(item.id)) continue;
    known.add(item.id);
    fresh.unshift(item);
  }
  return fresh.length ? [...fresh, ...feed] : feed;
}

/** Install a newest-first REST page taken at `baseline`, then newer buffered bundles. */
export function recover(
  page: readonly unknown[],
  baseline: number,
  buffered: readonly Buffered[],
): Feed {
  let feed: Feed = prepend([], [...page].reverse());
  for (const bundle of buffered)
    if (bundle.sequence > baseline) feed = prepend(feed, bundle.payload);
  return feed;
}
