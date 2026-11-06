// Reads the public inventory JSON the site publishes, cached for 5 minutes, so lead
// notifications can show the car's title/photo and stats can resolve titles.
import { Env, PublicListing } from './types.js';

export async function fetchListings(env: Env): Promise<Map<string, PublicListing>> {
  const out = new Map<string, PublicListing>();
  if (!env.SITE_URL) return out;
  const urls = [`${env.SITE_URL.replace(/\/+$/, '')}/api/listings.json`, `${env.SITE_URL.replace(/\/+$/, '')}/api/archive.json`];
  for (const url of urls) {
    try {
      const res = await fetch(url, { cf: { cacheTtl: 300, cacheEverything: true } } as RequestInit);
      if (!res.ok) continue;
      const data = (await res.json()) as { listings?: PublicListing[] };
      for (const l of data.listings ?? []) if (!out.has(String(l.id))) out.set(String(l.id), { ...l, id: String(l.id) });
    } catch { /* site may be down; notifications still go out without car details */ }
  }
  return out;
}
