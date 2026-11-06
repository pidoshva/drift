// Maps raw KSL JSON (search row or detail object) onto our Listing. Pure.
import { Listing, contentHash } from '../../core/listing.js';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim();
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const int = (v: unknown): number | null => { const n = num(v); return n === null ? null : Math.round(n); };
const epochIso = (v: unknown): string | null => { const n = num(v); return n ? new Date(n * 1000).toISOString() : null; };
const first = (v: unknown): string => (Array.isArray(v) ? str(v[0]) : str(v));

export const kslListingUrl = (id: string): string => `https://cars.ksl.com/listing/${id}`;

function photosOf(raw: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (u: unknown) => { const s = str(u); if (s && !out.includes(s)) out.push(s); };
  for (const key of ['photos', 'images']) {
    const arr = raw[key];
    if (Array.isArray(arr)) for (const p of arr) push(typeof p === 'object' && p ? (p as Record<string, unknown>).url : p);
  }
  const primary = raw.primaryImage as Record<string, unknown> | undefined;
  if (primary?.url) push(primary.url);
  return out;
}

/** Shared fields present on both the search row and the detail object. */
export function mapKslListing(raw: Record<string, unknown>, now: string, detail: boolean): Listing {
  const id = str(raw.id);
  const year = int(raw.makeYear);
  const location = (raw.location ?? {}) as Record<string, unknown>;
  const partial: Omit<Listing, 'hash'> = {
    id,
    source: 'ksl',
    url: kslListingUrl(id),
    title: str(raw.title) || [year, raw.make, raw.model, raw.trim].filter(Boolean).join(' '),
    year,
    make: str(raw.make),
    model: str(raw.model),
    trim: str(raw.trim),
    price: num(raw.price),
    msrp: num(raw.msrp) || null,
    mileage: int(raw.mileage),
    vin: str(raw.vin),
    stockNumber: str(raw.stockNumber),
    condition: str(raw.newUsed) || 'Used',
    body: str(raw.body),
    transmission: str(raw.transmission),
    fuel: str(raw.fuel),
    drive: str(raw.drive),
    cylinders: str(raw.cylinders),
    liters: str(raw.liters),
    doors: int(raw.numberDoors),
    seats: int(raw.numberOfSeats) || null,
    exteriorColor: first(raw.paint),
    interiorColor: first(raw.upholstery),
    titleType: str(raw.titleType),
    description: str(raw.description),
    options: Array.isArray(raw.options) ? raw.options.map(str).filter(Boolean) : [],
    photos: photosOf(raw),
    carfaxUrl: str(raw.carfaxUrl),
    location: { city: str(location.city), state: str(location.state), zip: str(location.zip) },
    status: 'active',
    firstSeenAt: now,
    lastSeenAt: now,
    soldAt: null,
    sourceCreatedAt: epochIso(raw.createdAt),
    sourceUpdatedAt: epochIso(raw.updatedAt),
    sourceExpiresAt: epochIso(raw.expiresAt),
    sourceStats: { pageViews: int(raw.pageViews), favorites: int(raw.favoriteCount) },
    priceHistory: [],
    detailFetchedAt: detail ? now : null,
  };
  return { ...partial, hash: contentHash(partial) };
}

export function kslStatus(raw: Record<string, unknown>): string {
  return str(raw.listingStatus) || str(raw.status);
}
