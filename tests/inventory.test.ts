import { describe, expect, it } from 'vitest';
import { applyChanges, mergeSnapshot, nextPriceHistory } from '../src/core/inventory.js';
import { Listing, ListingSchema, contentHash, daysBetween, formatMileage, formatPrice, listingPath, listingSlug } from '../src/core/listing.js';

const mk = (over: Partial<Listing>): Listing => {
  const base = ListingSchema.parse({ id: 'x', source: 'ksl', title: 't', firstSeenAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z', ...over });
  return { ...base, hash: contentHash(base) };
};
const NOW = '2026-02-01T00:00:00.000Z';

describe('mergeSnapshot', () => {
  it('classifies added / updated / unchanged / gone', () => {
    const current = [mk({ id: 'a', title: 'A', price: 100 }), mk({ id: 'b', title: 'B', price: 200 }), mk({ id: 'c', title: 'C', price: 300 })];
    const fresh = [mk({ id: 'a', title: 'A', price: 100 }), mk({ id: 'b', title: 'B', price: 150 }), mk({ id: 'd', title: 'D', price: 400 })];
    const ch = mergeSnapshot(current, fresh, (l) => (l.id === 'c' ? 'sold' : 'active'), NOW);
    expect(ch.unchanged.map((l) => l.id)).toEqual(['a']);
    expect(ch.updated.map((u) => u.after.id)).toEqual(['b']);
    expect(ch.added.map((l) => l.id)).toEqual(['d']);
    expect(ch.gone.map((g) => [g.listing.id, g.status, g.listing.soldAt])).toEqual([['c', 'sold', NOW]]);
    expect(ch.missing).toEqual([]);
    const next = applyChanges(ch);
    expect(next.map((l) => l.id).sort()).toEqual(['a', 'b', 'd']);
    expect(next.every((l) => l.lastSeenAt === NOW && l.status === 'active')).toBe(true);
  });
  it('keeps firstSeenAt from the earlier record and tracks price history', () => {
    const current = [mk({ id: 'a', price: 100, firstSeenAt: '2025-12-01T00:00:00.000Z', priceHistory: [{ at: '2025-12-01T00:00:00.000Z', price: 100 }] })];
    const ch = mergeSnapshot(current, [mk({ id: 'a', price: 90 })], () => 'sold', NOW);
    expect(ch.updated[0]!.after.firstSeenAt).toBe('2025-12-01T00:00:00.000Z');
    expect(ch.updated[0]!.after.priceHistory).toEqual([{ at: '2025-12-01T00:00:00.000Z', price: 100 }, { at: NOW, price: 90 }]);
  });
  it('unchanged listings still take the refreshed expiry and keep the earliest createdAt', () => {
    const before = mk({ id: 'a', sourceExpiresAt: '2026-01-10T00:00:00.000Z', sourceCreatedAt: '2025-12-01T00:00:00.000Z', detailFetchedAt: '2025-12-01T00:00:00.000Z' });
    const fresh = mk({ id: 'a', sourceExpiresAt: '2026-03-10T00:00:00.000Z', sourceCreatedAt: '2026-01-05T00:00:00.000Z' });
    const ch = mergeSnapshot([before], [fresh], () => 'sold', NOW);
    expect(ch.updated).toEqual([]);
    expect(ch.unchanged[0]).toMatchObject({ sourceExpiresAt: '2026-03-10T00:00:00.000Z', sourceCreatedAt: '2025-12-01T00:00:00.000Z', detailFetchedAt: '2025-12-01T00:00:00.000Z' });
    const noCreated = mergeSnapshot([mk({ id: 'b', sourceCreatedAt: null })], [mk({ id: 'b', sourceCreatedAt: '2026-01-05T00:00:00.000Z' })], () => 'sold', NOW);
    expect(noCreated.unchanged[0]!.sourceCreatedAt).toBe('2026-01-05T00:00:00.000Z');
  });
  it('keeps a listing active when resolveGone says it is still active (search glitch)', () => {
    const ch = mergeSnapshot([mk({ id: 'a' })], [], () => 'active', NOW);
    expect(ch.missing.map((l) => l.id)).toEqual(['a']);
    expect(ch.gone).toEqual([]);
  });
  it('nextPriceHistory ignores repeats', () => {
    const h = [{ at: '1', price: 5 }];
    expect(nextPriceHistory(h, 5, '2')).toBe(h);
    expect(nextPriceHistory(h, null, '2')).toHaveLength(2);
  });
});

describe('listing helpers', () => {
  it('slug/path/format', () => {
    expect(listingSlug({ id: '42', year: 2021, make: 'Toyota', model: 'Tacoma', trim: 'TRD Off-Road' })).toBe('2021-toyota-tacoma-trd-off-road-42');
    expect(listingPath({ id: '42', year: null, make: '', model: '', trim: '' })).toBe('/cars/car-42/');
    expect(formatPrice(38995)).toBe('$38,995');
    expect(formatPrice(null)).toBe('Call for price');
    expect(formatMileage(12345)).toBe('12,345 mi');
    expect(daysBetween('2026-01-01T00:00:00Z', '2026-01-11T12:00:00Z')).toBe(11);
  });
  it('contentHash ignores timestamps and stats', () => {
    const a = mk({ id: 'a', price: 1 });
    const b = { ...a, lastSeenAt: 'other', sourceStats: { pageViews: 9, favorites: 9 } };
    expect(contentHash(a)).toBe(contentHash(b));
    expect(contentHash({ ...a, price: 2 })).not.toBe(contentHash(a));
  });
});
