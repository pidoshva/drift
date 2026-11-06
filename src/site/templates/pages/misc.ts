import { Listing, listingPath } from '../../../core/listing.js';
import { SiteContext } from '../../context.js';
import { html } from '../html.js';
import { layout } from '../layout.js';

export function notFoundPage(ctx: SiteContext): { path: string; html: string } {
  const body = html`<section class="container section empty-state"><h1>Page not found</h1><p>That car may have sold. <a href="/inventory/">Browse current inventory →</a></p></section>`;
  return { path: '/404.html', html: layout(ctx, { title: 'Not found', description: 'Page not found', path: '/404.html', noindex: true }, body) };
}

export function sitemapXml(ctx: SiteContext): string {
  const urls = ['/', '/inventory/', '/contact/', ...(ctx.config.site.showSold ? ['/sold/'] : []), ...ctx.active.map(listingPath)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${ctx.siteUrl}${u}</loc><lastmod>${ctx.builtAt.slice(0, 10)}</lastmod></url>`).join('\n')}\n</urlset>\n`;
}

export function robotsTxt(ctx: SiteContext): string {
  return `User-agent: *\nAllow: /\nDisallow: /dash/\nSitemap: ${ctx.siteUrl}/sitemap.xml\n`;
}

/** Public JSON the worker (Telegram cards) and the dashboard read. Only public fields. */
export function publicListing(l: Listing): Record<string, unknown> {
  return {
    id: l.id, title: l.title, year: l.year, make: l.make, model: l.model, trim: l.trim, price: l.price, mileage: l.mileage,
    condition: l.condition, body: l.body, photo: l.photos[0] ?? null, url: l.url, path: listingPath(l), status: l.status,
    firstSeenAt: l.firstSeenAt, soldAt: l.soldAt, sourceViews: l.sourceStats.pageViews, sourceFavorites: l.sourceStats.favorites,
    priceHistory: l.priceHistory,
  };
}
