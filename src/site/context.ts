// Everything a template may need, computed once per build.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { Config, siteUrl } from '../core/config.js';
import { Listing } from '../core/listing.js';
import { PATHS } from '../core/paths.js';

export const ThemeSchema = z.object({
  nav: z.array(z.object({ label: z.string(), href: z.string() })).default([]),
  hero: z.object({ headline: z.string().default(''), subheadline: z.string().default(''), ctaLabel: z.string().default('Browse inventory'), imageUrl: z.string().default('') }).prefault({}),
  highlights: z.array(z.object({ title: z.string(), text: z.string() })).default([]),
  labels: z.object({
    inventory: z.string().default('Inventory'),
    sold: z.string().default('Recently sold'),
    contact: z.string().default('Contact'),
    callNow: z.string().default('Call now'),
    askAbout: z.string().default('Ask about this car'),
    viewOnKsl: z.string().default('View on KSL'),
    footerNote: z.string().default(''),
  }).prefault({}),
  cardFields: z.array(z.enum(['mileage', 'transmission', 'drive', 'fuel', 'body', 'exteriorColor'])).default(['mileage', 'transmission', 'drive']),
});
export type Theme = z.infer<typeof ThemeSchema>;

export interface SiteContext {
  config: Config;
  theme: Theme;
  siteUrl: string;
  /** '' for a root site, '/repo' for a GitHub Pages project site (derived from site url). */
  basePath: string;
  workerUrl: string;
  active: Listing[];
  sold: Listing[];
  builtAt: string;
  version: string;
}

export function loadTheme(dir: string = PATHS.theme): Theme {
  return ThemeSchema.parse(JSON.parse(readFileSync(join(dir, 'theme.json'), 'utf8')));
}

export function makeContext(config: Config, active: Listing[], archived: Listing[], opts: { builtAt?: string; version?: string } = {}): SiteContext {
  const builtAt = opts.builtAt ?? new Date().toISOString();
  const cutoff = Date.now() - config.site.soldDays * 86_400_000;
  const sold = archived
    .filter((l) => l.status === 'sold' && l.soldAt && Date.parse(l.soldAt) >= cutoff)
    .sort((a, b) => (b.soldAt ?? '').localeCompare(a.soldAt ?? ''));
  const url = siteUrl(config);
  return {
    config,
    theme: loadTheme(),
    siteUrl: url,
    basePath: basePathOf(url),
    workerUrl: config.worker.url.replace(/\/+$/, ''),
    active,
    sold,
    builtAt,
    version: opts.version ?? builtAt.replace(/\D/g, '').slice(0, 12),
  };
}

export function basePathOf(url: string): string {
  try { return new URL(url).pathname.replace(/\/+$/, ''); } catch { return ''; }
}
