// Manual source: JSON files in data/manual/*.json for cars that are not on KSL
// (or when KSL is down). Each file is one listing with at least {id, title}.
// Deleting the file marks the car as removed on the next sync.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Listing, ListingSchema, contentHash } from '../core/listing.js';
import { PATHS } from '../core/paths.js';
import { GoneResolution, InventorySource, ListingSummary } from './source.js';

export class ManualSource implements InventorySource {
  readonly name = 'manual' as const;
  constructor(private readonly dir: string = PATHS.manualDir, private readonly now: () => string = () => new Date().toISOString()) {}

  async listSummaries(): Promise<ListingSummary[]> {
    if (!existsSync(this.dir)) return [];
    const out: ListingSummary[] = [];
    for (const file of readdirSync(this.dir).filter((f) => f.endsWith('.json')).sort()) {
      const raw = JSON.parse(readFileSync(join(this.dir, file), 'utf8')) as Record<string, unknown>;
      const now = this.now();
      const parsed = ListingSchema.parse({ source: 'manual', firstSeenAt: now, lastSeenAt: now, status: 'active', ...raw, id: String(raw.id ?? file.replace(/\.json$/, '')) });
      const listing: Listing = { ...parsed, detailFetchedAt: now, hash: contentHash(parsed) };
      out.push({ id: listing.id, price: listing.price, sourceUpdatedAt: null, partial: listing });
    }
    return out;
  }

  async fetchDetail(summary: ListingSummary): Promise<Listing> { return summary.partial; }
  async resolveGone(): Promise<GoneResolution> { return { status: 'removed' }; }
}
