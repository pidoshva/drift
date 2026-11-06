// End-to-end sync against the mock KSL, in a temp data directory.
import { readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmp = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  return mkdtempSync(join(tmpdir(), 'drift-sync-'));
});
vi.mock('../src/core/paths.js', async (orig) => {
  const real = (await orig()) as { PATHS: Record<string, string> };
  return { ...real, PATHS: { ...real.PATHS, data: tmp, inventory: join(tmp, 'inventory.json'), archive: join(tmp, 'archive.json'), manualDir: join(tmp, 'manual'), localState: join(tmp, '.drift'), localLog: join(tmp, '.drift', 'drift.log') } };
});

import { loadConfig } from '../src/core/config.js';
import { loadArchive, loadInventory } from '../src/core/inventory.js';
import { formatSyncMessage, runSync } from '../src/jobs/sync.js';
import { KslClient } from '../src/sources/ksl/client.js';
import { KslSource } from '../src/sources/ksl/index.js';
import { createMockKslFetch } from '../src/sources/ksl/mock.js';
import { ManualSource } from '../src/sources/manual.js';
import { disableLogFile, setLogLevel } from '../src/core/logger.js';

disableLogFile();
setLogLevel('error');
const config = loadConfig();
const ksl = (opts: Parameters<typeof createMockKslFetch>[0] = {}) => new KslSource({ memberId: 'mock', maxPages: 10, client: new KslClient({ delayMs: 0, fetchImpl: createMockKslFetch({ ...opts, perPage: 5 }) }) });

beforeEach(() => { rmSync(tmp, { recursive: true, force: true }); mkdirSync(join(tmp, 'manual'), { recursive: true }); });
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('runSync with mock KSL', () => {
  it('first run adds every seed listing with details, paging through 5-per-page', async () => {
    const r = await runSync(config, { sources: [ksl()], notify: false });
    expect(r.ok).toBe(true);
    expect(r.totals).toMatchObject({ active: 14, added: 14, updated: 0, gone: 0, detailFetches: 14 });
    const inv = loadInventory();
    expect(inv.listings).toHaveLength(14);
    expect(inv.listings.every((l) => l.description.length > 20 && l.photos.length === 5 && l.detailFetchedAt)).toBe(true);
    expect(inv.listings.every((l) => l.priceHistory.length === 1)).toBe(true);
  });

  it('second run is idempotent and fetches no details', async () => {
    await runSync(config, { sources: [ksl()], notify: false });
    const before = readFileSync(join(tmp, 'inventory.json'), 'utf8');
    const r = await runSync(config, { sources: [ksl()], notify: false });
    expect(r.totals).toMatchObject({ added: 0, updated: 0, gone: 0, detailFetches: 0 });
    const after = JSON.parse(readFileSync(join(tmp, 'inventory.json'), 'utf8'));
    expect(after.listings.map((l: { id: string; hash: string }) => l.id + l.hash)).toEqual(JSON.parse(before).listings.map((l: { id: string; hash: string }) => l.id + l.hash));
  });

  it('detects price drops and sold cars, moving sold ones to the archive', async () => {
    await runSync(config, { sources: [ksl()], notify: false });
    const r = await runSync(config, { sources: [ksl({ sold: ['90000100', '90000105'], prices: { '90000101': 19999 } })], notify: false });
    expect(r.totals).toMatchObject({ active: 12, added: 0, updated: 1, gone: 2, detailFetches: 1 });
    expect(r.priceDrops.map((p) => [p.listing.id, p.from, p.to])).toEqual([['90000101', 21450, 19999]]);
    expect(r.gone.map((g) => [g.listing.id, g.status]).sort()).toEqual([['90000100', 'sold'], ['90000105', 'sold']]);
    const arc = loadArchive();
    expect(arc.listings.map((l) => l.id).sort()).toEqual(['90000100', '90000105']);
    expect(arc.listings.every((l) => l.status === 'sold' && l.soldAt)).toBe(true);
    expect(loadInventory().listings.find((l) => l.id === '90000101')!.priceHistory).toHaveLength(2);
    const msg = formatSyncMessage(config, r);
    expect(msg).toContain('📉');
    expect(msg).toContain('✅ Sold');
  });

  it('dry run writes nothing', async () => {
    const r = await runSync(config, { sources: [ksl()], notify: false, dryRun: true });
    expect(r.totals.added).toBe(14);
    expect(loadInventory().listings).toHaveLength(0);
  });

  it('keeps the previous inventory when the source fails', async () => {
    await runSync(config, { sources: [ksl()], notify: false });
    const broken = new KslSource({ memberId: 'mock', maxPages: 1, client: new KslClient({ delayMs: 0, maxRetries: 0, fetchImpl: async () => new Response('down', { status: 503 }) }) });
    const r = await runSync(config, { sources: [broken], notify: false });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/HTTP 503/);
    expect(loadInventory().listings).toHaveLength(14);
  });

  it('merges manual listings and removes them when the file disappears', async () => {
    const file = join(tmp, 'manual', 'm1.json');
    writeFileSync(file, JSON.stringify({ id: 'm1', title: '2010 Honda Fit', year: 2010, make: 'Honda', model: 'Fit', price: 5500, photos: [] }));
    const r1 = await runSync(config, { sources: [ksl(), new ManualSource(join(tmp, 'manual'))], notify: false });
    expect(r1.totals.active).toBe(15);
    rmSync(file);
    const r2 = await runSync(config, { sources: [ksl(), new ManualSource(join(tmp, 'manual'))], notify: false });
    expect(r2.gone.map((g) => [g.listing.id, g.status])).toEqual([['m1', 'removed']]);
    expect(loadArchive().listings[0]!.status).toBe('removed');
  });
});
