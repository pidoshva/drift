// The Listing is the one domain object the whole system shares: sources produce it,
// the sync job stores it, the site renders it, the worker reads it (via /api/listings.json).
import { createHash } from 'node:crypto';
import { z } from 'zod';

export const ListingStatusSchema = z.enum(['active', 'sold', 'removed', 'expired']);
export type ListingStatus = z.infer<typeof ListingStatusSchema>;

export const ListingSchema = z.object({
  id: z.string().min(1),
  source: z.enum(['ksl', 'manual']),
  url: z.string().default(''),
  title: z.string().min(1),
  year: z.number().int().nullable().default(null),
  make: z.string().default(''),
  model: z.string().default(''),
  trim: z.string().default(''),
  price: z.number().nullable().default(null),
  msrp: z.number().nullable().default(null),
  mileage: z.number().nullable().default(null),
  vin: z.string().default(''),
  stockNumber: z.string().default(''),
  condition: z.string().default('Used'),
  body: z.string().default(''),
  transmission: z.string().default(''),
  fuel: z.string().default(''),
  drive: z.string().default(''),
  cylinders: z.string().default(''),
  liters: z.string().default(''),
  doors: z.number().int().nullable().default(null),
  seats: z.number().int().nullable().default(null),
  exteriorColor: z.string().default(''),
  interiorColor: z.string().default(''),
  titleType: z.string().default(''),
  description: z.string().default(''),
  options: z.array(z.string()).default([]),
  photos: z.array(z.string()).default([]),
  carfaxUrl: z.string().default(''),
  location: z.object({ city: z.string().default(''), state: z.string().default(''), zip: z.string().default('') }).default({ city: '', state: '', zip: '' }),
  status: ListingStatusSchema.default('active'),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  soldAt: z.string().nullable().default(null),
  sourceCreatedAt: z.string().nullable().default(null),
  sourceUpdatedAt: z.string().nullable().default(null),
  sourceExpiresAt: z.string().nullable().default(null),
  sourceStats: z.object({ pageViews: z.number().nullable().default(null), favorites: z.number().nullable().default(null) }).default({ pageViews: null, favorites: null }),
  priceHistory: z.array(z.object({ at: z.string(), price: z.number().nullable() })).default([]),
  detailFetchedAt: z.string().nullable().default(null),
  hash: z.string().default(''),
});
export type Listing = z.infer<typeof ListingSchema>;

/** Fields that mean "the car changed" when they differ. Timestamps and stats are excluded. */
const HASH_FIELDS: (keyof Listing)[] = [
  'title', 'year', 'make', 'model', 'trim', 'price', 'msrp', 'mileage', 'vin', 'stockNumber', 'condition', 'body',
  'transmission', 'fuel', 'drive', 'cylinders', 'liters', 'doors', 'seats', 'exteriorColor', 'interiorColor',
  'titleType', 'description', 'options', 'photos', 'carfaxUrl', 'location',
];

export function contentHash(listing: Partial<Listing>): string {
  const h = createHash('sha1');
  for (const f of HASH_FIELDS) h.update(JSON.stringify(listing[f] ?? null));
  return h.digest('hex').slice(0, 16);
}

export function listingSlug(l: Pick<Listing, 'id' | 'year' | 'make' | 'model' | 'trim'>): string {
  const base = [l.year, l.make, l.model, l.trim].filter(Boolean).join(' ').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${base || 'car'}-${l.id}`;
}

export function listingPath(l: Pick<Listing, 'id' | 'year' | 'make' | 'model' | 'trim'>): string {
  return `/cars/${listingSlug(l)}/`;
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000));
}

export function formatPrice(price: number | null): string {
  if (price === null || price === 0) return 'Call for price';
  return '$' + Math.round(price).toLocaleString('en-US');
}

export function formatMileage(m: number | null): string {
  return m === null ? '—' : m.toLocaleString('en-US') + ' mi';
}
