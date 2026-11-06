// Adapter contract for anything that can supply inventory. Add a new marketplace by
// implementing this interface and registering it in `src/sources/index.ts`.
import { Listing, ListingStatus } from '../core/listing.js';

/** Lightweight row from a search/listing page; enough to decide whether to fetch details. */
export interface ListingSummary {
  id: string;
  price: number | null;
  sourceUpdatedAt: string | null;
  partial: Listing; // best-effort listing built from the summary alone
  /** `partial` already is the full listing (no detail page exists); the job uses it as-is, so every edit lands. */
  complete?: boolean;
}

/**
 * Outcome of checking a listing that vanished from the source. `unresolved` is set when the
 * check was inconclusive (rate limit, outage, parse failure): the job keeps the car and
 * reports the reason so a persistent failure is visible, not silent.
 */
export interface GoneResolution {
  status: ListingStatus;
  unresolved?: string;
}

export interface InventorySource {
  readonly name: Listing['source'];
  /** Every listing currently for sale, as summaries. */
  listSummaries(): Promise<ListingSummary[]>;
  /** Full listing (photos, description, specs). May throw; the job keeps the summary then. */
  fetchDetail(summary: ListingSummary): Promise<Listing>;
  /** Called for a listing that was active but is no longer in listSummaries(). */
  resolveGone(listing: Listing): Promise<GoneResolution>;
}
