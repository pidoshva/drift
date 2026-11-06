// Adapter contract for anything that can supply inventory. Add a new marketplace by
// implementing this interface and registering it in `src/sources/index.ts`.
import { Listing, ListingStatus } from '../core/listing.js';

/** Lightweight row from a search/listing page; enough to decide whether to fetch details. */
export interface ListingSummary {
  id: string;
  price: number | null;
  sourceUpdatedAt: string | null;
  partial: Listing; // best-effort listing built from the summary alone
}

export interface InventorySource {
  readonly name: Listing['source'];
  /** Every listing currently for sale, as summaries. */
  listSummaries(): Promise<ListingSummary[]>;
  /** Full listing (photos, description, specs). May throw; the job keeps the summary then. */
  fetchDetail(summary: ListingSummary): Promise<Listing>;
  /** Called for a listing that was active but is no longer in listSummaries(). */
  resolveGone(listing: Listing): Promise<ListingStatus>;
}
