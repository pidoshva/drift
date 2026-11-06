// Static site build: data/*.json + theme + templates -> dist/. Pure function of inputs,
// so running it twice with the same data yields the same output.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Config } from '../core/config.js';
import { loadArchive, loadInventory } from '../core/inventory.js';
import { log } from '../core/logger.js';
import { PATHS } from '../core/paths.js';
import { SiteContext, makeContext } from './context.js';
import { contactPage } from './templates/pages/contact.js';
import { dashboardPage } from './templates/pages/dashboard.js';
import { homePage } from './templates/pages/home.js';
import { inventoryPage } from './templates/pages/inventory.js';
import { listingPage } from './templates/pages/listing.js';
import { notFoundPage, publicListing, robotsTxt, sitemapXml } from './templates/pages/misc.js';
import { soldPage } from './templates/pages/sold.js';

const logger = log('build');

export interface BuildResult { outDir: string; pages: number; listings: number; sold: number; ms: number; }

export function buildSite(config: Config, opts: { outDir?: string; builtAt?: string } = {}): BuildResult {
  const t0 = Date.now();
  const outDir = opts.outDir ?? PATHS.dist;
  const inventory = loadInventory();
  const archive = loadArchive();
  const ctx = makeContext(config, inventory.listings.filter((l) => l.status === 'active'), archive.listings, { builtAt: opts.builtAt ?? inventory.syncedAt ?? undefined });

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const pages = [homePage(ctx), inventoryPage(ctx), contactPage(ctx), dashboardPage(ctx), notFoundPage(ctx), ...(config.site.showSold ? [soldPage(ctx)] : []), ...ctx.active.map((l) => listingPage(ctx, l))];
  for (const p of pages) writePage(outDir, p.path, applyBasePath(p.html, ctx.basePath));

  writeText(outDir, '/sitemap.xml', sitemapXml(ctx));
  writeText(outDir, '/robots.txt', robotsTxt(ctx));
  writeText(outDir, '/.nojekyll', '');
  writeText(outDir, '/api/listings.json', JSON.stringify({ generatedAt: ctx.builtAt, dealer: config.dealer.name, listings: ctx.active.map(publicListing) }));
  writeText(outDir, '/api/archive.json', JSON.stringify({ generatedAt: ctx.builtAt, listings: archive.listings.map(publicListing) }));
  writeAssets(outDir, ctx);

  const result = { outDir, pages: pages.length, listings: ctx.active.length, sold: ctx.sold.length, ms: Date.now() - t0 };
  logger.info('site built', result);
  return result;
}

/**
 * GitHub Pages project sites live under /<repo>/. Templates always write root-absolute
 * links (href="/inventory/") so they stay simple; this single pass prefixes them.
 */
export function applyBasePath(html: string, basePath: string): string {
  if (!basePath) return html;
  return html.replace(/\b(href|src)="\/(?!\/)/g, `$1="${basePath}/`);
}

function writePage(outDir: string, path: string, content: string): void {
  const file = path.endsWith('.html') ? path : join(path, 'index.html');
  writeText(outDir, file, content);
}

function writeText(outDir: string, path: string, content: string): void {
  const file = join(outDir, path);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content);
}

function writeAssets(outDir: string, _ctx: SiteContext): void {
  const assets = join(outDir, 'assets');
  mkdirSync(assets, { recursive: true });
  const css = ['tokens.css', 'base.css', 'components.css'].map((f) => `/* ${f} */\n` + readFileSync(join(PATHS.theme, f), 'utf8')).join('\n');
  writeFileSync(join(assets, 'site.css'), css);
  for (const f of readdirSync(PATHS.client)) cpSync(join(PATHS.client, f), join(assets, f));
  cpSync(join(PATHS.theme, 'assets'), assets, { recursive: true });
}
