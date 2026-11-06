import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { tmp, data } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const tmp = mkdtempSync(join(tmpdir(), 'drift-site-'));
  return { tmp, data: join(tmp, 'data') };
});
vi.mock('../src/core/paths.js', async (orig) => {
  const real = (await orig()) as { PATHS: Record<string, string> };
  return { ...real, PATHS: { ...real.PATHS, data, inventory: join(data, 'inventory.json'), archive: join(data, 'archive.json'), manualDir: join(data, 'manual'), localState: join(tmp, '.drift'), localLog: join(tmp, '.drift', 'drift.log'), dist: join(tmp, 'dist') } };
});

import { loadConfig } from '../src/core/config.js';
import { disableLogFile, setLogLevel } from '../src/core/logger.js';
import { runSync } from '../src/jobs/sync.js';
import { applyBasePath, buildSite } from '../src/site/build.js';
import { basePathOf } from '../src/site/context.js';
import { escapeHtml, html, raw } from '../src/site/templates/html.js';
import { KslClient } from '../src/sources/ksl/client.js';
import { KslSource } from '../src/sources/ksl/index.js';
import { createMockKslFetch } from '../src/sources/ksl/mock.js';
import { ManualSource } from '../src/sources/manual.js';

disableLogFile(); setLogLevel('error');
const out = join(tmp, 'dist');
const ksl = (o: Parameters<typeof createMockKslFetch>[0] = {}) => new KslSource({ memberId: 'mock', maxPages: 5, client: new KslClient({ delayMs: 0, fetchImpl: createMockKslFetch(o) }) });

beforeAll(async () => {
  await runSync(loadConfig(), { sources: [ksl()], notify: false });
  await runSync(loadConfig(), { sources: [ksl({ sold: ['90000100'] })], notify: false });
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('html helper', () => {
  it('escapes by default and passes raw through', () => {
    expect(html`<b>${'<x>'}</b>${raw('<i>')}`.value).toBe('<b>&lt;x&gt;</b><i>');
    expect(escapeHtml(`"'&`)).toBe('&quot;&#39;&amp;');
    expect(html`${[1, null, false, 'a']}`.value).toBe('1a');
  });
});

describe('buildSite', () => {
  it('produces every page, JSON feeds and assets', () => {
    const config = { ...loadConfig(), site: { ...loadConfig().site, url: 'https://example.com' }, worker: { ...loadConfig().worker, url: 'https://w.example.com' } };
    const r = buildSite(config, { outDir: out, builtAt: '2026-02-01T00:00:00.000Z' });
    expect(r.listings).toBe(13);
    expect(r.sold).toBe(1);
    for (const f of ['index.html', 'inventory/index.html', 'sold/index.html', 'contact/index.html', 'dash/index.html', '404.html', 'sitemap.xml', 'robots.txt', '.nojekyll', 'api/listings.json', 'api/archive.json', 'assets/site.css', 'assets/site.js', 'assets/dash.js', 'assets/logo.svg', 'assets/placeholder.svg']) expect(existsSync(join(out, f)), f).toBe(true);
    const home = readFileSync(join(out, 'index.html'), 'utf8');
    expect(home).toContain('data-worker-url="https://w.example.com"');
    expect(home).toContain('<link rel="canonical" href="https://example.com/">');
    expect(home).toContain('Demo Motors');
    const inv = readFileSync(join(out, 'inventory/index.html'), 'utf8');
    expect(inv.match(/class="car-card"/g)!.length).toBe(13);
    const listings = JSON.parse(readFileSync(join(out, 'api/listings.json'), 'utf8'));
    expect(listings.listings).toHaveLength(13);
    expect(Object.keys(listings.listings[0])).toEqual(expect.arrayContaining(['id', 'title', 'price', 'photo', 'path', 'url', 'sourceViews']));
    expect(JSON.stringify(listings)).not.toContain('"vin"');
    const archive = JSON.parse(readFileSync(join(out, 'api/archive.json'), 'utf8'));
    expect(archive.listings[0]).toMatchObject({ id: '90000100', status: 'sold' });
    const car = readFileSync(join(out, listings.listings[0].path, 'index.html'), 'utf8');
    expect(car).toContain(`data-listing-id="${listings.listings[0].id}"`);
    expect(car).toContain('application/ld+json');
    expect(car).toContain('data-contact-form');
    expect(car).toContain('View on KSL');
    const sitemap = readFileSync(join(out, 'sitemap.xml'), 'utf8');
    expect(sitemap.match(/<url>/g)!.length).toBe(4 + 13);
    expect(sitemap).not.toContain('/dash/');
    expect(readFileSync(join(out, 'sold/index.html'), 'utf8')).toContain('badge--sold');
  });

  it('escapes listing content in HTML', async () => {
    const manualDir = join(data, 'manual');
    mkdirSync(manualDir, { recursive: true });
    const evil = '<script>alert(1)</script>';
    writeFileSync(join(manualDir, 'evil.json'), JSON.stringify({ id: 'evil', title: `2015 Ford "Focus" ${evil}`, year: 2015, make: 'Ford', model: 'Focus', price: 9000, description: `Clean car ${evil} & more`, options: [`Sunroof ${evil}`] }));
    const config = loadConfig();
    const r = await runSync(config, { sources: [ksl({ sold: ['90000100'] }), new ManualSource(manualDir)], notify: false });
    expect(r.added.map((l) => l.id)).toEqual(['evil']);
    buildSite(config, { outDir: out });
    const escaped = '&lt;script&gt;alert(1)&lt;/script&gt;';
    const inv = readFileSync(join(out, 'inventory/index.html'), 'utf8');
    expect(inv).toContain(escaped);
    expect(inv).not.toContain(evil);
    const listings = JSON.parse(readFileSync(join(out, 'api/listings.json'), 'utf8'));
    const car = readFileSync(join(out, listings.listings.find((l: { id: string }) => l.id === 'evil').path, 'index.html'), 'utf8');
    expect(car).toContain(escaped);
    expect(car).not.toContain(evil);
    expect(car).toContain('<title>');
    rmSync(join(manualDir, 'evil.json'));
    await runSync(config, { sources: [ksl({ sold: ['90000100'] }), new ManualSource(manualDir)], notify: false });
  });

  it('rewrites root links for a GitHub Pages project site', () => {
    expect(basePathOf('https://user.github.io/drift/')).toBe('/drift');
    expect(basePathOf('https://cars.example.com')).toBe('');
    expect(applyBasePath('<a href="/inventory/"><img src="/assets/x.svg"><a href="//cdn/x"><a href="https://a/b">', '/drift')).toBe('<a href="/drift/inventory/"><img src="/drift/assets/x.svg"><a href="//cdn/x"><a href="https://a/b">');
    const config = { ...loadConfig(), site: { ...loadConfig().site, url: 'https://user.github.io/drift' } };
    buildSite(config, { outDir: out });
    const home = readFileSync(join(out, 'index.html'), 'utf8');
    expect(home).toContain('href="/drift/assets/site.css');
    expect(home).toContain('data-base="/drift"');
    expect(home).toContain('href="/drift/inventory/"');
  });
});
