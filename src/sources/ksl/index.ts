// KSL Cars adapter. KSL has no public dealer API, so this reads the same server-rendered
// pages a browser gets:
//   search:  https://cars.ksl.com/search/memberId/<id>/page/<n>   (20 listings per page)
//   detail:  https://cars.ksl.com/listing/<id>                    (photos, description, specs)
// Details are fetched only for new/changed listings or when stale, keeping volume tiny.
import { Listing } from '../../core/listing.js';
import { Logger, log } from '../../core/logger.js';
import { GoneResolution, InventorySource, ListingSummary } from '../source.js';
import { HttpStatusError, KslClient } from './client.js';
import { kslStatus, mapKslListing } from './map.js';
import { parseDetailPage, parseSearchPage } from './rsc.js';

export interface KslSourceOptions {
  memberId: string;
  client: KslClient;
  maxPages: number;
  logger?: Logger;
  now?: () => string;
}


export class KslSource implements InventorySource {
  readonly name = 'ksl' as const;
  private readonly logger: Logger;
  private readonly now: () => string;
  constructor(private readonly opts: KslSourceOptions) {
    this.logger = opts.logger ?? log('ksl');
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  searchUrl(page: number): string {
    return `https://cars.ksl.com/search/memberId/${encodeURIComponent(this.opts.memberId)}${page > 1 ? `/page/${page}` : ''}`;
  }

  async listSummaries(): Promise<ListingSummary[]> {
    if (!this.opts.memberId) throw new Error('sources.ksl.memberId is not set (drift config set sources.ksl.memberId <id>)');
    const seen = new Map<string, ListingSummary>();
    let total = Infinity;
    for (let page = 1; page <= this.opts.maxPages; page++) {
      const html = await this.opts.client.getHtml(this.searchUrl(page));
      const parsed = parseSearchPage(html);
      total = parsed.total;
      let fresh = 0;
      for (const raw of parsed.items) {
        const partial = mapKslListing(raw, this.now(), false);
        if (seen.has(partial.id)) continue;
        fresh++;
        seen.set(partial.id, { id: partial.id, price: partial.price, sourceUpdatedAt: partial.sourceUpdatedAt, partial });
      }
      this.logger.info(`search page ${page}`, { items: parsed.items.length, fresh, total, hasNextPage: parsed.hasNextPage });
      // Stop when the page said "no more", when we have everything KSL counts, or when a page
      // adds nothing new (duplicate page = we ran off the end). Never trust a fixed page size.
      if (fresh === 0 || parsed.hasNextPage === false || seen.size >= total) break;
    }
    if (Number.isFinite(total) && seen.size < total) {
      this.logger.warn('collected fewer listings than KSL reports', { collected: seen.size, total });
    }
    return [...seen.values()];
  }

  async fetchDetail(summary: ListingSummary): Promise<Listing> {
    const html = await this.opts.client.getHtml(summary.partial.url);
    const raw = parseDetailPage(html);
    const full = mapKslListing(raw, this.now(), true);
    // The search row sometimes carries fields the detail omits; prefer detail, fall back to summary.
    return {
      ...summary.partial,
      ...full,
      photos: full.photos.length ? full.photos : summary.partial.photos,
      sourceCreatedAt: full.sourceCreatedAt ?? summary.partial.sourceCreatedAt,
      sourceExpiresAt: full.sourceExpiresAt ?? summary.partial.sourceExpiresAt,
      sourceStats: {
        pageViews: full.sourceStats.pageViews ?? summary.partial.sourceStats.pageViews,
        favorites: full.sourceStats.favorites ?? summary.partial.sourceStats.favorites,
      },
    };
  }

  /**
   * A listing dropped off the dealer's search page. Only a confirmed non-Active status or a
   * 404/410 archives it; anything unresolved (rate limit, outage, layout change) keeps the car
   * so a KSL hiccup never removes inventory. The next run re-checks it.
   */
  async resolveGone(listing: Listing): Promise<GoneResolution> {
    const pastExpiry = Boolean(listing.sourceExpiresAt && Date.parse(listing.sourceExpiresAt) < Date.now());
    try {
      const html = await this.opts.client.getHtml(listing.url);
      const raw = parseDetailPage(html);
      const status = kslStatus(raw).toLowerCase();
      this.logger.debug('gone check', { id: listing.id, status });
      if (status === 'active') return { status: 'active' };
      if (status.includes('sold')) return { status: 'sold' };
      if (status.includes('expire')) return { status: 'expired' };
      if (!status) {
        this.logger.warn('gone check: page has no status; keeping listing', { id: listing.id });
        return { status: 'active', unresolved: 'listing page has no status (layout changed?)' };
      }
      return { status: pastExpiry ? 'expired' : 'sold' };
    } catch (err) {
      if (err instanceof HttpStatusError && (err.status === 404 || err.status === 410)) return { status: pastExpiry ? 'expired' : 'sold' };
      this.logger.warn('gone check failed; keeping listing until the next run', { id: listing.id, error: String(err) });
      return { status: 'active', unresolved: (err as Error).message };
    }
  }
}
