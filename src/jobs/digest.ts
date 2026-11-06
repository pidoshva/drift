// Daily digest: pulls yesterday's analytics from the worker and inventory facts from data/,
// formats one Telegram message. Runs from GitHub Actions (`drift digest --send`) on `digest.cron`.
import { Config, siteUrl } from '../core/config.js';
import { formatPrice, daysBetween, listingPath } from '../core/listing.js';
import { loadArchive, loadInventory } from '../core/inventory.js';
import { AdminClient, StatsResponse } from '../core/admin-client.js';
import { esc } from '../notify/telegram.js';

export interface DigestData {
  stats: StatsResponse | null;
  active: number;
  soldLast30: number;
  avgDaysToSell: number | null;
  newest: { title: string; price: number | null; path: string }[];
}

export async function buildDigest(config: Config, admin: AdminClient | null, days = 1): Promise<DigestData> {
  const inv = loadInventory();
  const archive = loadArchive();
  const cutoff = Date.now() - 30 * 86_400_000;
  const sold = archive.listings.filter((l) => l.status === 'sold' && l.soldAt && Date.parse(l.soldAt) >= cutoff);
  const dts = sold.map((l) => daysBetween(l.firstSeenAt, l.soldAt!));
  let stats: StatsResponse | null = null;
  if (admin) { try { stats = await admin.stats(days); } catch { stats = null; } }
  return {
    stats,
    active: inv.listings.length,
    soldLast30: sold.length,
    avgDaysToSell: dts.length ? Math.round(dts.reduce((a, b) => a + b, 0) / dts.length) : null,
    newest: inv.listings.slice(0, 3).map((l) => ({ title: l.title, price: l.price, path: listingPath(l) })),
  };
}

export function formatDigest(config: Config, d: DigestData, label = 'Yesterday'): string {
  const site = siteUrl(config);
  const lines = [`<b>📊 ${esc(config.dealer.name)} — ${label}</b>`];
  if (d.stats) {
    const t = d.stats.totals;
    lines.push(`👀 ${t.pageviews} page views · ${t.visitors} visitors · ${t.listingViews} car views · ✉️ ${t.leads} leads`);
    if (d.stats.topListings.length) {
      lines.push('<b>Most viewed</b>');
      for (const l of d.stats.topListings.slice(0, 5)) lines.push(`• ${esc(l.title || l.listingId)} — ${l.views}`);
    }
    if (d.stats.topReferrers.length) lines.push(`<b>Traffic from:</b> ${d.stats.topReferrers.slice(0, 4).map((r) => `${esc(r.referrer || 'direct')} (${r.count})`).join(', ')}`);
  } else {
    lines.push('(web analytics unavailable)');
  }
  lines.push(`🚗 ${d.active} cars live · ✅ ${d.soldLast30} sold in last 30 days${d.avgDaysToSell !== null ? ` · ⏱ avg ${d.avgDaysToSell} days to sell` : ''}`);
  if (d.newest.length) lines.push('<b>Newest:</b> ' + d.newest.map((n) => `<a href="${site}${n.path}">${esc(n.title)}</a> ${formatPrice(n.price)}`).join(' · '));
  lines.push(`<a href="${site}/dash/">Open dashboard</a>`);
  return lines.join('\n');
}
