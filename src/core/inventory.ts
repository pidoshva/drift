// Inventory store = two committed JSON files:
//   data/inventory.json  -> listings currently for sale (status: active)
//   data/archive.json    -> listings that left the lot (sold / removed / expired), kept for stats
// Plus the pure merge logic the sync job uses to turn a fresh source snapshot into changes.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { Listing, ListingSchema, ListingStatus, contentHash } from './listing.js';
import { PATHS } from './paths.js';

export const InventoryFileSchema = z.object({
  version: z.literal(1).default(1),
  syncedAt: z.string().nullable().default(null),
  listings: z.array(ListingSchema).default([]),
});
export type InventoryFile = z.infer<typeof InventoryFileSchema>;

export function readInventoryFile(path: string): InventoryFile {
  if (!existsSync(path)) return { version: 1, syncedAt: null, listings: [] };
  return InventoryFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export function writeInventoryFile(path: string, file: InventoryFile): void {
  mkdirSync(dirname(path), { recursive: true });
  const sorted = { ...file, listings: [...file.listings].sort(byNewest) };
  writeFileSync(path, JSON.stringify(sorted, null, 2) + '\n');
}

export const loadInventory = (): InventoryFile => readInventoryFile(PATHS.inventory);
export const loadArchive = (): InventoryFile => readInventoryFile(PATHS.archive);

export function byNewest(a: Listing, b: Listing): number {
  return (b.sourceCreatedAt ?? b.firstSeenAt).localeCompare(a.sourceCreatedAt ?? a.firstSeenAt);
}

export interface SyncChanges {
  added: Listing[];
  updated: { before: Listing; after: Listing }[];
  unchanged: Listing[];
  gone: { listing: Listing; status: ListingStatus }[];
  /** Listings missing from the source this run but not confirmed gone (kept active). */
  missing: Listing[];
}

/**
 * Merges a fresh snapshot from one source into the current active set for that source.
 * `fresh` contains fully-populated listings (detail fetched where needed).
 * `resolveGone` decides what happened to a listing that disappeared (sold/removed/expired/active).
 */
export function mergeSnapshot(
  current: Listing[],
  fresh: Listing[],
  resolveGone: (l: Listing) => ListingStatus,
  now: string,
): SyncChanges {
  const changes: SyncChanges = { added: [], updated: [], unchanged: [], gone: [], missing: [] };
  const currentById = new Map(current.map((l) => [l.id, l]));
  const freshIds = new Set(fresh.map((l) => l.id));

  for (const incoming of fresh) {
    const before = currentById.get(incoming.id);
    const after: Listing = {
      ...incoming,
      hash: contentHash(incoming),
      firstSeenAt: before?.firstSeenAt ?? incoming.firstSeenAt ?? now,
      lastSeenAt: now,
      status: 'active',
      soldAt: null,
      priceHistory: nextPriceHistory(before?.priceHistory ?? [], incoming.price, now),
    };
    if (!before) changes.added.push(after);
    else if (before.hash !== after.hash) changes.updated.push({ before, after });
    else changes.unchanged.push({ ...before, lastSeenAt: now, sourceStats: after.sourceStats, sourceUpdatedAt: after.sourceUpdatedAt, detailFetchedAt: after.detailFetchedAt ?? before.detailFetchedAt });
  }

  for (const existing of current) {
    if (freshIds.has(existing.id)) continue;
    const status = resolveGone(existing);
    if (status === 'active') changes.missing.push(existing);
    else changes.gone.push({ listing: { ...existing, status, soldAt: now, lastSeenAt: existing.lastSeenAt }, status });
  }
  return changes;
}

export function nextPriceHistory(history: Listing['priceHistory'], price: number | null, now: string): Listing['priceHistory'] {
  const last = history[history.length - 1];
  if (last && last.price === price) return history;
  return [...history, { at: now, price }];
}

export function applyChanges(changes: SyncChanges): Listing[] {
  return [...changes.added, ...changes.updated.map((u) => u.after), ...changes.unchanged, ...changes.missing];
}

export function summarizeChanges(c: SyncChanges): Record<string, number> {
  return { added: c.added.length, updated: c.updated.length, unchanged: c.unchanged.length, gone: c.gone.length, missing: c.missing.length };
}
