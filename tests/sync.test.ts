// End-to-end sync against the mock KSL, in a temp data directory.
import { readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
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
import { loadArchive, loadInventory, markListing } from '../src/core/inventory.js';
import { formatSyncMessage, runSync, shouldNotify } from '../src/jobs/sync.js';
import { KslClient } from '../src/sources/ksl/client.js';
import { KslSource } from '../src/sources/ksl/index.js';
import { createMockKslFetch } from '../src/sources/ksl/mock.js';
import { ManualSource } from '../src/sources/manual.js';
import { disableLogFile, setLogLevel } from '../src/core/logger.js';

disableLogFile();
setLogLevel('error');
const config = loadConfig();
const ksl = (opts: Parameters<typeof createMockKslFetch>[0] = {}) => new KslSource({ memberId: 'mock', maxPages: 10, client: new KslClient({ delayMs: 0, fetchImpl: createMockKslFetch({ ...opts, perPage: 5 }) }) });
/** Mock KSL where the detail page of `id` answers with `status` instead of a listing page. */
const kslWithBrokenDetail = (id: string, status: number, opts: Parameters<typeof createMockKslFetch>[0] = {}) => {
  const base = createMockKslFetch({ ...opts, perPage: 5 });
  const fetchImpl: typeof fetch = async (input, init) => (String(input).endsWith(`/listing/${id}`) ? new Response('nope', { status }) : base(input, init));
  return new KslSource({ memberId: 'mock', maxPages: 10, client: new KslClient({ delayMs: 0, maxRetries: 0, fetchImpl }) });
};

beforeEach(() => { rmSync(tmp, { recursive: true, force: true }); mkdirSync(join(tmp, 'manual'), { recursive: true }); });
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('runSync with mock KSL', () => {
  it('first run adds every seed listing with details, paging through 5-per-page', async () => {
    const r = await runSync(config, { sources: [ksl()], notify: false });
    expect(r.ok).toBe(true);
    expect(r.wrote).toBe(true);
    expect(r.totals).toMatchObject({ active: 14, added: 14, updated: 0, gone: 0, detailFetches: 14 });
    const inv = loadInventory();
    expect(inv.listings).toHaveLength(14);
    expect(inv.listings.every((l) => l.description.length > 20 && l.photos.length === 5 && l.detailFetchedAt)).toBe(true);
    expect(inv.listings.every((l) => l.priceHistory.length === 1)).toBe(true);
  });

  it('second run is idempotent, fetches no details and keeps every detail-only field', async () => {
    await runSync(config, { sources: [ksl()], notify: false });
    const before = loadInventory().listings;
    const r = await runSync(config, { sources: [ksl()], notify: false });
    expect(r.ok).toBe(true);
    expect(r.wrote).toBe(false);
    expect(r.totals).toMatchObject({ added: 0, updated: 0, gone: 0, detailFetches: 0, warnings: 0 });
    const after = loadInventory().listings;
    expect(after.map((l) => l.id + l.hash)).toEqual(before.map((l) => l.id + l.hash));
    for (const l of after) {
      const b = before.find((x) => x.id === l.id)!;
      expect(l.description).toBe(b.description);
      expect(l.options).toEqual(b.options);
      expect(l.photos).toEqual(b.photos);
      expect(l.detailFetchedAt).toBe(b.detailFetchedAt);
      expect(l.sourceStats.pageViews).toBe(b.sourceStats.pageViews);
      expect(l.sourceUpdatedAt).toBe(b.sourceUpdatedAt);
      for (const f of ['vin', 'body', 'transmission', 'fuel', 'drive', 'stockNumber', 'carfaxUrl', 'exteriorColor', 'titleType'] as const) {
        expect(b[f], `${l.id}.${f} should be seeded`).not.toBe('');
        expect(l[f], `${l.id}.${f}`).toBe(b[f]);
      }
    }
  });

  it('a car that comes back after being archived lives in inventory only', async () => {
    await runSync(config, { sources: [ksl()], notify: false });
    await runSync(config, { sources: [ksl({ sold: ['90000100'] })], notify: false });
    expect(loadArchive().listings.map((l) => l.id)).toEqual(['90000100']);
    const r = await runSync(config, { sources: [ksl()], notify: false });
    expect(r.totals).toMatchObject({ active: 14, added: 1, gone: 0 });
    expect(loadArchive().listings).toEqual([]);
    expect(loadInventory().listings.find((l) => l.id === '90000100')).toMatchObject({ status: 'active', soldAt: null });
  });

  it('keeps a car whose gone check fails (503), reports it as unverified, and archives it on 404', async () => {
    await runSync(config, { sources: [ksl()], notify: false });
    const r1 = await runSync(config, { sources: [kslWithBrokenDetail('90000100', 503, { sold: ['90000100'] })], notify: false });
    expect(r1.ok).toBe(true);
    expect(r1.totals).toMatchObject({ active: 14, gone: 0, warnings: 1 });
    expect(r1.perSource.ksl).toMatchObject({ missing: 1 });
    expect(r1.unverified.map((u) => u.listing.id)).toEqual(['90000100']);
    expect(r1.unverified[0]!.reason).toMatch(/HTTP 503/);
    expect(r1.warnings).toEqual([]);
    const msg = formatSyncMessage(config, r1);
    expect(msg).toContain('1 listing(s) could not be verified');
    expect(msg).not.toContain('warning(s)');
    expect(msg.match(/HTTP 503/g)).toHaveLength(1);
    expect(shouldNotify(config, r1)).toBe(true);
    expect(loadInventory().listings.find((l) => l.id === '90000100')!.status).toBe('active');
    const r2 = await runSync(config, { sources: [kslWithBrokenDetail('90000100', 404, { sold: ['90000100'] })], notify: false });
    expect(r2.gone.map((g) => [g.listing.id, g.status])).toEqual([['90000100', 'sold']]);
    expect(loadInventory().listings).toHaveLength(13);
  });

  it('a failed detail fetch is a warning, not an error: the summary is kept and ok stays true', async () => {
    const r = await runSync(config, { sources: [kslWithBrokenDetail('90000100', 503)], notify: false });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/90000100.*HTTP 503/);
    expect(r.totals).toMatchObject({ active: 14, added: 14, detailFetches: 13, warnings: 1 });
    const l = loadInventory().listings.find((x) => x.id === '90000100')!;
    expect(l.detailFetchedAt).toBeNull();
    expect(l.title).not.toBe('');
    expect(formatSyncMessage(config, r)).toContain('1 warning(s)');
  });

  it('a quiet run leaves data/ byte-for-byte untouched; a price change writes', async () => {
    await runSync(config, { sources: [ksl()], notify: false });
    const files = [join(tmp, 'inventory.json'), join(tmp, 'archive.json')];
    const snapshot = files.map((f) => ({ text: readFileSync(f, 'utf8'), mtime: statSync(f).mtimeMs }));
    await new Promise((r) => setTimeout(r, 20));
    const quiet = await runSync(config, { sources: [ksl()], notify: false });
    expect(quiet.wrote).toBe(false);
    expect(files.map((f) => ({ text: readFileSync(f, 'utf8'), mtime: statSync(f).mtimeMs }))).toEqual(snapshot);
    const priced = await runSync(config, { sources: [ksl({ prices: { '90000101': 19999 } })], notify: false });
    expect(priced.wrote).toBe(true);
    expect(priced.totals.updated).toBe(1);
    expect(readFileSync(files[0]!, 'utf8')).not.toBe(snapshot[0]!.text);
    expect(loadInventory().listings.find((l) => l.id === '90000101')!.price).toBe(19999);
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

  it('a hand mark to sold sticks across syncs while KSL still lists the car; marking active re-syncs it', async () => {
    await runSync(config, { sources: [ksl()], notify: false });
    const marked = markListing('90000100', 'sold', '2026-03-01T00:00:00.000Z');
    expect(marked).toMatchObject({ status: 'sold', soldAt: '2026-03-01T00:00:00.000Z', statusLockedAt: '2026-03-01T00:00:00.000Z' });
    expect(loadInventory().listings).toHaveLength(13);
    const r1 = await runSync(config, { sources: [ksl()], notify: false });
    expect(r1.totals).toMatchObject({ active: 13, added: 0, gone: 0, detailFetches: 0 });
    expect(loadInventory().listings.map((l) => l.id)).not.toContain('90000100');
    expect(loadArchive().listings.map((l) => l.id)).toEqual(['90000100']);
    expect(loadArchive().listings[0]).toMatchObject({ status: 'sold', statusLockedAt: '2026-03-01T00:00:00.000Z' });
    expect(markListing('90000100', 'active')).toMatchObject({ status: 'active', soldAt: null, statusLockedAt: null });
    const r2 = await runSync(config, { sources: [ksl()], notify: false });
    expect(r2.totals).toMatchObject({ active: 14, added: 0, gone: 0 });
    expect(loadArchive().listings).toEqual([]);
    expect(loadInventory().listings.find((l) => l.id === '90000100')).toMatchObject({ status: 'active', statusLockedAt: null });
    expect(() => markListing('nope', 'sold')).toThrow(/not found/);
  });

  it('shouldNotify: changes mode fires on changes, failures and unverified cars; always/never override', async () => {
    const quiet = await (async () => { await runSync(config, { sources: [ksl()], notify: false }); return runSync(config, { sources: [ksl()], notify: false }); })();
    const changes = { ...config, sync: { ...config.sync, notify: 'changes' as const } };
    expect(shouldNotify(changes, quiet)).toBe(false);
    expect(shouldNotify(changes, { ...quiet, totals: { ...quiet.totals, updated: 1 } })).toBe(true);
    expect(shouldNotify(changes, { ...quiet, ok: false })).toBe(true);
    expect(shouldNotify(changes, { ...quiet, unverified: [{ listing: quiet.added[0] ?? loadInventory().listings[0]!, reason: 'HTTP 503' }] })).toBe(true);
    expect(shouldNotify({ ...config, sync: { ...config.sync, notify: 'always' } }, quiet)).toBe(true);
    expect(shouldNotify({ ...config, sync: { ...config.sync, notify: 'never' } }, { ...quiet, ok: false, totals: { ...quiet.totals, added: 3 } })).toBe(false);
  });

  it('dry run writes nothing', async () => {
    const r = await runSync(config, { sources: [ksl()], notify: false, dryRun: true });
    expect(r.totals.added).toBe(14);
    expect(r.wrote).toBe(false);
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

  it('an edit to a manual listing file lands on the next sync; an unchanged file stays quiet', async () => {
    const dir = join(tmp, 'manual');
    const file = join(dir, 'm1.json');
    const car = { id: 'm1', title: '2010 Honda Fit', year: 2010, make: 'Honda', model: 'Fit', price: 5500, description: 'Runs great.', photos: [] };
    writeFileSync(file, JSON.stringify(car));
    const r1 = await runSync(config, { sources: [ksl(), new ManualSource(dir)], notify: false });
    expect(r1.totals).toMatchObject({ active: 15, added: 15, detailFetches: 14 });
    const firstSeen = loadInventory().listings.find((l) => l.id === 'm1')!.firstSeenAt;
    writeFileSync(file, JSON.stringify({ ...car, description: 'Runs great. New tires.', options: ['Bluetooth'] }));
    const r2 = await runSync(config, { sources: [ksl(), new ManualSource(dir)], notify: false });
    expect(r2.totals).toMatchObject({ active: 15, added: 0, updated: 1, gone: 0, detailFetches: 0 });
    expect(r2.wrote).toBe(true);
    const m1 = loadInventory().listings.find((l) => l.id === 'm1')!;
    expect(m1).toMatchObject({ description: 'Runs great. New tires.', options: ['Bluetooth'], firstSeenAt: firstSeen });
    expect(m1.priceHistory).toHaveLength(1);
    const r3 = await runSync(config, { sources: [ksl(), new ManualSource(dir)], notify: false });
    expect(r3.totals).toMatchObject({ updated: 0, detailFetches: 0 });
    expect(r3.wrote).toBe(false);
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
