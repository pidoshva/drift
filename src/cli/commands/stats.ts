import { Command } from 'commander';
import { loadConfig } from '../../core/config.js';
import { AdminClient } from '../../core/admin-client.js';
import { loadArchive, loadInventory } from '../../core/inventory.js';
import { daysBetween, formatPrice } from '../../core/listing.js';
import { heading, info, printJson, table, warn } from '../ui.js';

export function registerStats(program: Command): void {
  program
    .command('stats')
    .description('Analytics: website traffic, car views, leads, sales (worker + local data)')
    .option('-d, --days <n>', 'window in days', (v) => parseInt(v, 10), 30)
    .option('--json', 'JSON output')
    .option('--local', 'skip the worker; inventory/sales stats only')
    .action(async (opts) => {
      const config = loadConfig();
      const inv = loadInventory();
      const arc = loadArchive();
      const since = Date.now() - opts.days * 86_400_000;
      const sold = arc.listings.filter((l) => l.status === 'sold' && l.soldAt && Date.parse(l.soldAt) >= since);
      const dts = sold.map((l) => daysBetween(l.firstSeenAt, l.soldAt!));
      const byId = new Map([...inv.listings, ...arc.listings].map((l) => [l.id, l]));
      const local = {
        active: inv.listings.length, sold: sold.length, revenue: sold.reduce((a, l) => a + (l.price ?? 0), 0),
        avgDaysToSell: dts.length ? Math.round(dts.reduce((a, b) => a + b, 0) / dts.length) : null,
        soldByMake: count(sold.map((l) => l.make)), inventoryByBody: count(inv.listings.map((l) => l.body || '?')),
        kslTop: [...inv.listings].sort((a, b) => (b.sourceStats.pageViews ?? 0) - (a.sourceStats.pageViews ?? 0)).slice(0, 10).map((l) => ({ title: l.title, kslViews: l.sourceStats.pageViews ?? 0, favorites: l.sourceStats.favorites ?? 0 })),
      };
      let remote = null;
      if (!opts.local) {
        try { remote = await AdminClient.fromConfig(config).stats(opts.days); }
        catch (err) { warn(`worker stats unavailable: ${(err as Error).message}`); }
      }
      if (opts.json) { printJson({ days: opts.days, local, remote }); return; }

      heading(`Inventory & sales — last ${opts.days} days`);
      info(`${local.active} cars live · ${local.sold} sold · ${formatPrice(local.revenue)} sold value · avg ${local.avgDaysToSell ?? '—'} days to sell`);
      if (sold.length) { heading('Sold'); table(sold.slice(0, 15).map((l) => ({ soldAt: l.soldAt!.slice(0, 10), title: l.title, price: formatPrice(l.price), days: daysBetween(l.firstSeenAt, l.soldAt!) }))); }
      heading('Sold by make'); table(local.soldByMake);
      heading('KSL views (from KSL listing pages)'); table(local.kslTop);
      if (!remote) return;
      const t = remote.totals;
      heading(`Website — ${remote.from.slice(0, 10)} → ${remote.to.slice(0, 10)}`);
      info(`${t.pageviews} page views · ${t.visitors} visitors · ${t.listingViews} car views · ${t.leads} leads · ${t.callClicks} call clicks · ${t.kslClicks} KSL clicks`);
      heading('Most viewed cars'); table(remote.topListings.slice(0, 10).map((r) => ({ title: byId.get(r.listingId)?.title ?? r.title ?? r.listingId, views: r.views, leads: r.leads })));
      heading('Traffic sources'); table(remote.topReferrers.map((r) => ({ source: r.referrer || 'direct', visits: r.count })));
      heading('Locations'); table(remote.cities.slice(0, 10).map((c) => ({ city: c.city || '?', region: c.region, country: c.country, visits: c.count })));
      heading('Devices'); table(remote.devices);
      heading('Daily'); table(remote.daily.slice(-14));
    });
}

function count(values: string[]): { name: string; count: number }[] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v || '?', (m.get(v || '?') ?? 0) + 1);
  return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}
