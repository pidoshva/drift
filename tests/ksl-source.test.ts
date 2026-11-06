// KslSource.resolveGone: what happens to a car that vanished from the dealer's search page.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ListingSchema } from '../src/core/listing.js';
import { disableLogFile, setLogLevel } from '../src/core/logger.js';
import { KslClient } from '../src/sources/ksl/client.js';
import { KslSource } from '../src/sources/ksl/index.js';
import { createMockKslFetch } from '../src/sources/ksl/mock.js';

disableLogFile(); setLogLevel('error');

const listing = (over: Partial<ReturnType<typeof ListingSchema.parse>> = {}) =>
  ListingSchema.parse({ id: '90000100', source: 'ksl', url: 'https://cars.ksl.com/listing/90000100', title: 'x', firstSeenAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z', ...over });
const source = (fetchImpl: typeof fetch) => new KslSource({ memberId: 'mock', maxPages: 1, client: new KslClient({ delayMs: 0, maxRetries: 0, fetchImpl }) });
const status = (code: number): typeof fetch => async () => new Response('', { status: code });

describe('KslSource.fetchDetail', () => {
  it('keeps search-row stats the detail page lacks and takes the ones it has', async () => {
    const searchHtml = readFileSync(new URL('./fixtures/ksl-search-page.html', import.meta.url), 'utf8');
    const detailHtml = readFileSync(new URL('./fixtures/ksl-detail-page.html', import.meta.url), 'utf8').replace(/\\"favoriteCount\\": \d+, /, '');
    expect(detailHtml).not.toContain('favoriteCount');
    const fetchImpl: typeof fetch = async (input) => new Response(String(input).includes('/listing/') ? detailHtml : searchHtml, { status: 200 });
    const src = source(fetchImpl);
    const summary = (await src.listSummaries()).find((s) => s.id === '10762373')!;
    expect(summary.partial.sourceStats).toEqual({ pageViews: null, favorites: 12 });
    const full = await src.fetchDetail(summary);
    expect(full.sourceStats).toEqual({ pageViews: 348, favorites: 12 });
    expect(full.detailFetchedAt).not.toBeNull();
    expect(full.sourceExpiresAt).toBe(summary.partial.sourceExpiresAt);
  });
});

describe('KslSource.resolveGone', () => {
  it('404 / 410 -> sold', async () => {
    expect(await source(status(404)).resolveGone(listing())).toEqual({ status: 'sold' });
    expect(await source(status(410)).resolveGone(listing())).toEqual({ status: 'sold' });
  });
  it('404 past the listing expiry -> expired', async () => {
    expect(await source(status(404)).resolveGone(listing({ sourceExpiresAt: '2020-01-01T00:00:00.000Z' }))).toEqual({ status: 'expired' });
  });
  it('503 / 429 / network error / unparseable page -> active with an unresolved reason', async () => {
    expect(await source(status(503)).resolveGone(listing({ sourceExpiresAt: '2020-01-01T00:00:00.000Z' }))).toMatchObject({ status: 'active', unresolved: expect.stringMatching(/HTTP 503/) });
    expect(await source(status(429)).resolveGone(listing())).toMatchObject({ status: 'active', unresolved: expect.stringMatching(/HTTP 429/) });
    expect(await source(async () => { throw new TypeError('fetch failed'); }).resolveGone(listing())).toMatchObject({ status: 'active', unresolved: 'fetch failed' });
    expect(await source(async () => new Response('<html>search page</html>', { status: 200 })).resolveGone(listing())).toMatchObject({ status: 'active', unresolved: expect.stringMatching(/listing block/) });
  });
  it('page says Sold -> sold, page says Active -> active with no reason', async () => {
    expect(await source(createMockKslFetch({ sold: ['90000100'] })).resolveGone(listing())).toEqual({ status: 'sold' });
    expect(await source(createMockKslFetch()).resolveGone(listing())).toEqual({ status: 'active' });
  });
});
