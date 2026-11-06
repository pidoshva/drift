import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { balancedEnd, extractFlightPayload, parseDetailPage, parseSearchPage, resolveRef } from '../src/sources/ksl/rsc.js';
import { kslStatus, mapKslListing } from '../src/sources/ksl/map.js';

const search = readFileSync(new URL('./fixtures/ksl-search-page.html', import.meta.url), 'utf8');
const detail = readFileSync(new URL('./fixtures/ksl-detail-page.html', import.meta.url), 'utf8');

describe('flight payload helpers', () => {
  it('concatenates chunks split across pushes', () => {
    const p = extractFlightPayload(search);
    expect(p).toContain('"initialState":{"results":');
  });
  it('balancedEnd handles braces inside strings', () => {
    const s = '{"a":"}{","b":[1,{"c":"]"}]} tail';
    expect(s.slice(0, balancedEnd(s, 0))).toBe('{"a":"}{","b":[1,{"c":"]"}]}');
  });
  it('resolves T-rows by UTF-8 byte length and plain JSON string rows', () => {
    const text = 'héllo ✓';
    const bytes = Buffer.byteLength(text, 'utf8').toString(16);
    const payload = `1:"x"\n4b:T${bytes},${text}c:["next"]\n5:"short"\n`;
    expect(resolveRef(payload, '$4b')).toBe(text);
    expect(resolveRef(payload, '$5')).toBe('short');
    expect(resolveRef(payload, '$zz')).toBeNull();
    expect(resolveRef(payload, 'literal')).toBe('literal');
  });
});

describe('parseSearchPage', () => {
  it('returns items and paging info', () => {
    const page = parseSearchPage(search);
    expect(page.items.length).toBe(2);
    expect(page.total).toBe(2);
    expect(page.hasNextPage).toBe(false);
    expect(page.items[0]!.id).toBe(10762373);
  });
  it('throws a clear error on a changed layout', () => {
    expect(() => parseSearchPage('<html></html>')).toThrow(/results block not found/);
  });
});

describe('parseDetailPage + mapKslListing', () => {
  it('extracts the listing with description resolved (multibyte safe)', () => {
    const raw = parseDetailPage(detail);
    expect(raw.id).toBe(10762373);
    expect(String(raw.description)).toContain('Ünïcödé check ✓');
    expect(String(raw.description).startsWith('Certified.')).toBe(true);
    expect(kslStatus(raw)).toBe('Active');
    const l = mapKslListing(raw, '2026-01-01T00:00:00.000Z', true);
    expect(l).toMatchObject({ id: '10762373', source: 'ksl', year: 2023, make: 'GMC', model: '1500', trim: 'Elevation', price: 26989, mileage: 100367, condition: 'Certified', body: 'Truck', transmission: 'Automatic', drive: '4-Wheel Drive', exteriorColor: 'White', interiorColor: 'Black', vin: '3GTUUCED3PG185413', stockNumber: '700116' });
    expect(l.photos.length).toBe(30);
    expect(l.photos[0]).toMatch(/^https:\/\/image\.ksldigital\.com\//);
    expect(l.options).toEqual(['Sunroof', 'Tow package']);
    expect(l.sourceStats.pageViews).toBe(348);
    expect(l.sourceCreatedAt).toBe(new Date(1787276298 * 1000).toISOString());
    expect(l.url).toBe('https://cars.ksl.com/listing/10762373');
    expect(l.hash).toHaveLength(16);
  });
  it('maps a search row without detail fields', () => {
    const row = parseSearchPage(search).items[0]!;
    const l = mapKslListing(row, '2026-01-01T00:00:00.000Z', false);
    expect(l.title).toBe('2023 GMC 1500 Elevation');
    expect(l.photos).toEqual(['https://image.ksldigital.com/18431207-0152-440f-b1e5-4ef67c19e78e.jpg']);
    expect(l.detailFetchedAt).toBeNull();
    expect(l.location.city).toBe('Salt Lake City');
  });
});
