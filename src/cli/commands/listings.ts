import { Command } from 'commander';
import { loadArchive, loadInventory, writeInventoryFile } from '../../core/inventory.js';
import { ListingStatusSchema, daysBetween, formatMileage, formatPrice, listingPath } from '../../core/listing.js';
import { PATHS } from '../../core/paths.js';
import { die, ok, printJson, table } from '../ui.js';

export function registerListings(program: Command): void {
  const cmd = program.command('listings').description('Inspect and correct inventory data');

  cmd.command('list')
    .description('List active listings (or --archived)')
    .option('--archived', 'show sold/removed listings instead')
    .option('--json', 'JSON output')
    .action((opts) => {
      const file = opts.archived ? loadArchive() : loadInventory();
      if (opts.json) { printJson(file.listings); return; }
      table(file.listings.map((l) => ({
        id: l.id, title: l.title, price: formatPrice(l.price), mileage: formatMileage(l.mileage), status: l.status,
        days: daysBetween(l.firstSeenAt, l.soldAt ?? new Date().toISOString()), kslViews: l.sourceStats.pageViews ?? '', photos: l.photos.length, src: l.source,
      })));
      console.log(`\n  ${file.listings.length} listings · synced ${file.syncedAt ?? 'never'}`);
    });

  cmd.command('show <id>')
    .description('Print one listing as JSON')
    .action((id) => {
      const l = [...loadInventory().listings, ...loadArchive().listings].find((x) => x.id === id);
      if (!l) die(`listing ${id} not found`);
      printJson({ ...l, sitePath: listingPath(l) });
    });

  cmd.command('mark <id> <status>')
    .description('Force a status: active | sold | removed | expired (moves between inventory and archive)')
    .action((id, statusRaw) => {
      const status = ListingStatusSchema.parse(statusRaw);
      const inv = loadInventory();
      const arc = loadArchive();
      const all = [...inv.listings, ...arc.listings];
      const l = all.find((x) => x.id === id);
      if (!l) die(`listing ${id} not found`);
      const now = new Date().toISOString();
      const updated = { ...l, status, soldAt: status === 'active' ? null : (l.soldAt ?? now) };
      const rest = all.filter((x) => x.id !== id);
      writeInventoryFile(PATHS.inventory, { ...inv, listings: [...rest.filter((x) => x.status === 'active'), ...(status === 'active' ? [updated] : [])] });
      writeInventoryFile(PATHS.archive, { ...arc, listings: [...rest.filter((x) => x.status !== 'active'), ...(status !== 'active' ? [updated] : [])] });
      ok(`${l.title} → ${status}. Run \`drift build\` (or push) to publish.`);
    });
}
