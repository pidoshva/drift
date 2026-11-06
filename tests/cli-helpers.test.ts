import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { everyToCron, setWorkflowCron } from '../src/cli/commands/schedule.js';
import { ConfigSchema, getPath, setPath, siteUrl } from '../src/core/config.js';
import { renderWranglerConfig } from '../src/cli/commands/worker.js';
import { buildDigest, formatDigest } from '../src/jobs/digest.js';

describe('schedule helpers', () => {
  it('converts intervals to cron', () => {
    expect(everyToCron('30m')).toBe('*/30 * * * *');
    expect(everyToCron('2h')).toBe('17 */2 * * *');
    expect(everyToCron('1d')).toBe('17 9 * * *');
    expect(() => everyToCron('7m')).toThrow();
    expect(() => everyToCron('weekly')).toThrow();
  });
  it('rewrites the tagged cron line only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drift-wf-'));
    const f = join(dir, 'sync.yml');
    writeFileSync(f, "on:\n  schedule:\n    - cron: '17 */2 * * *'  # drift:sync-cron\n    - cron: '0 0 * * *'\n");
    setWorkflowCron(f, 'sync', '*/30 * * * *');
    expect(readFileSync(f, 'utf8')).toBe("on:\n  schedule:\n    - cron: '*/30 * * * *'  # drift:sync-cron\n    - cron: '0 0 * * *'\n");
    expect(() => setWorkflowCron(f, 'digest', '1 2 3 4 5')).toThrow(/marker/);
    rmSync(dir, { recursive: true });
  });
});

const base = ConfigSchema.parse({ dealer: { name: 'X' }, site: {}, sources: { ksl: {}, manual: {} }, sync: {}, contact: {}, worker: {}, analytics: {}, digest: {} });

describe('config helpers', () => {
  it('getPath/setPath coerce by existing type', () => {
    const raw = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    setPath(raw, 'site.soldDays', '90');
    setPath(raw, 'site.showSold', 'false');
    setPath(raw, 'contact.methods', 'telegram,email');
    setPath(raw, 'contact.phone', '+1801');
    const parsed = ConfigSchema.parse(raw);
    expect(parsed.site.soldDays).toBe(90);
    expect(parsed.site.showSold).toBe(false);
    expect(parsed.contact.methods).toEqual(['telegram', 'email']);
    expect(getPath(parsed, 'contact.phone')).toBe('+1801');
    expect(getPath(parsed, 'nope.x')).toBeUndefined();
  });
  it('siteUrl falls back to the GitHub Pages URL in CI', () => {
    const prev = process.env.GITHUB_REPOSITORY;
    process.env.GITHUB_REPOSITORY = 'Someone/drift';
    expect(siteUrl(base)).toBe('https://someone.github.io/drift');
    expect(siteUrl({ ...base, site: { ...base.site, url: 'https://x.com/' } })).toBe('https://x.com');
    if (prev === undefined) delete process.env.GITHUB_REPOSITORY; else process.env.GITHUB_REPOSITORY = prev;
  });
  it('renders wrangler config from drift.config.json', () => {
    const cfg = { ...base, worker: { ...base.worker, name: 'drift-demo', d1DatabaseId: 'abc' }, contact: { ...base.contact, telegramChatId: '123', methods: ['telegram', 'email'] as ('telegram' | 'email')[] }, site: { ...base.site, url: 'https://x.com' } };
    const toml = renderWranglerConfig(cfg);
    expect(toml).toContain('name = "drift-demo"');
    expect(toml).toContain('database_id = "abc"');
    expect(toml).toContain('TELEGRAM_CHAT_ID = "123"');
    expect(toml).toContain('CONTACT_METHODS = "telegram,email"');
    expect(toml).toContain('SITE_URL = "https://x.com"');
    expect(toml).not.toContain('__');
  });
});

describe('digest', () => {
  it('formats with and without worker stats', async () => {
    const cfg = { ...base, dealer: { ...base.dealer, name: 'Demo' } };
    const d = await buildDigest(cfg, null, 1);
    const text = formatDigest(cfg, d);
    expect(text).toContain('Demo');
    expect(text).toContain('analytics unavailable');
    const fake = { stats: (days: number) => Promise.resolve({ days, from: '', to: '', totals: { pageviews: 10, visitors: 4, listingViews: 6, leads: 1, callClicks: 0, kslClicks: 0 }, daily: [], topListings: [{ listingId: '1', title: 'Car <1>', views: 3, leads: 0 }], topReferrers: [{ referrer: 'google.com', count: 2 }], topPaths: [], countries: [], cities: [], devices: [], recentLeads: [], jobs: [] }) };
    const d2 = await buildDigest(cfg, fake as never, 1);
    const t2 = formatDigest(cfg, d2);
    expect(t2).toContain('10 page views');
    expect(t2).toContain('Car &lt;1&gt;');
    expect(t2).toContain('google.com (2)');
  });
});
