// The sync job: pull inventory from every enabled source, merge into data/, report.
// Runs on a schedule in GitHub Actions (`.github/workflows/sync.yml`) and locally via `drift sync`.
import { Config, siteUrl } from '../core/config.js';
import { secret } from '../core/env.js';
import { Listing, ListingStatus, daysBetween, formatPrice, listingPath } from '../core/listing.js';
import { SyncChanges, applyChanges, loadArchive, loadInventory, mergeSnapshot, summarizeChanges, writeInventoryFile } from '../core/inventory.js';
import { errorData, log } from '../core/logger.js';
import { PATHS } from '../core/paths.js';
import { InventorySource, ListingSummary } from '../sources/source.js';
import { esc, sendTelegram } from '../notify/telegram.js';
import { postJobEvent } from './events.js';

const logger = log('sync');

export interface SyncOptions {
  sources: InventorySource[];
  dryRun?: boolean;
  /** Fetch details for at most N listings (debugging). */
  limit?: number;
  /** Re-fetch every detail even if fresh. */
  force?: boolean;
  notify?: boolean;
  now?: () => string;
}

export interface SyncReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  ok: boolean;
  dryRun: boolean;
  perSource: Record<string, Record<string, number>>;
  totals: { active: number; added: number; updated: number; gone: number; detailFetches: number; errors: number };
  added: Listing[];
  gone: { listing: Listing; status: ListingStatus }[];
  priceDrops: { listing: Listing; from: number | null; to: number | null }[];
  errors: string[];
}

export async function runSync(config: Config, opts: SyncOptions): Promise<SyncReport> {
  const now = opts.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const t0 = Date.now();
  const inventory = loadInventory();
  const archive = loadArchive();
  const report: SyncReport = {
    startedAt, finishedAt: startedAt, durationMs: 0, ok: true, dryRun: Boolean(opts.dryRun), perSource: {},
    totals: { active: 0, added: 0, updated: 0, gone: 0, detailFetches: 0, errors: 0 }, added: [], gone: [], priceDrops: [], errors: [],
  };
  const nextActive: Listing[] = [];
  const nextArchive: Listing[] = [...archive.listings];
  const refreshMs = config.sources.ksl.detailRefreshHours * 3_600_000;

  for (const source of opts.sources) {
    const slog = logger.child(source.name);
    const current = inventory.listings.filter((l) => l.source === source.name);
    const currentById = new Map(current.map((l) => [l.id, l]));
    let summaries: ListingSummary[];
    try {
      summaries = await source.listSummaries();
    } catch (err) {
      slog.error('listing failed; keeping previous inventory for this source', errorData(err));
      report.errors.push(`${source.name}: ${(err as Error).message}`);
      nextActive.push(...current);
      continue;
    }
    slog.info('summaries collected', { count: summaries.length, previouslyActive: current.length });

    const fresh: Listing[] = [];
    let fetched = 0;
    for (const s of summaries) {
      const before = currentById.get(s.id);
      const stale = !before?.detailFetchedAt || Date.now() - Date.parse(before.detailFetchedAt) > refreshMs;
      const changed = !before || before.price !== s.price || (s.sourceUpdatedAt && s.sourceUpdatedAt !== before.sourceUpdatedAt);
      const needDetail = opts.force || changed || stale;
      if (needDetail && (opts.limit === undefined || fetched < opts.limit)) {
        try {
          fresh.push(await source.fetchDetail(s));
          fetched++;
          slog.debug('detail fetched', { id: s.id, reason: !before ? 'new' : changed ? 'changed' : 'stale' });
          continue;
        } catch (err) {
          slog.warn('detail fetch failed; using summary', { id: s.id, ...errorData(err) });
          report.errors.push(`${source.name}:${s.id}: ${(err as Error).message}`);
        }
      }
      // Keep the rich fields we already have; refresh the cheap ones from the summary.
      fresh.push(before ? { ...before, ...s.partial, description: before.description || s.partial.description, options: before.options.length ? before.options : s.partial.options, photos: s.partial.photos.length > before.photos.length ? s.partial.photos : before.photos, detailFetchedAt: before.detailFetchedAt } : s.partial);
    }
    report.totals.detailFetches += fetched;

    const goneStatus = new Map<string, ListingStatus>();
    for (const l of current) {
      if (summaries.some((s) => s.id === l.id)) continue;
      try { goneStatus.set(l.id, await source.resolveGone(l)); }
      catch (err) { slog.warn('resolveGone failed, assuming sold', { id: l.id, ...errorData(err) }); goneStatus.set(l.id, 'sold'); }
    }
    const changes = mergeSnapshot(current, fresh, (l) => goneStatus.get(l.id) ?? 'sold', now());
    report.perSource[source.name] = summarizeChanges(changes);
    collect(report, changes);
    nextActive.push(...applyChanges(changes));
    nextArchive.push(...changes.gone.map((g) => g.listing));
    slog.info('merged', report.perSource[source.name]);
  }

  // Sources disabled in config: their cars stay as they were.
  const handled = new Set(opts.sources.map((s) => s.name));
  nextActive.push(...inventory.listings.filter((l) => !handled.has(l.source)));

  report.totals.active = nextActive.length;
  report.totals.errors = report.errors.length;
  report.ok = report.errors.length === 0;
  report.finishedAt = now();
  report.durationMs = Date.now() - t0;

  if (!opts.dryRun) {
    writeInventoryFile(PATHS.inventory, { version: 1, syncedAt: report.finishedAt, listings: nextActive });
    writeInventoryFile(PATHS.archive, { version: 1, syncedAt: report.finishedAt, listings: nextArchive });
    logger.info('inventory written', { active: nextActive.length, archived: nextArchive.length });
  } else {
    logger.info('dry run: nothing written', report.totals);
  }

  const changed = report.totals.added + report.totals.updated + report.totals.gone > 0;
  if (opts.notify !== false && !opts.dryRun) {
    await postJobEvent(config, 'sync', report.ok ? 'ok' : 'error', { ...report.totals, perSource: report.perSource, durationMs: report.durationMs, errors: report.errors.slice(0, 5) });
    const mode = config.sync.notify;
    if (mode === 'always' || (mode === 'changes' && (changed || !report.ok))) await notifySync(config, report);
  }
  return report;
}

function collect(report: SyncReport, c: SyncChanges): void {
  report.totals.added += c.added.length;
  report.totals.updated += c.updated.length;
  report.totals.gone += c.gone.length;
  report.added.push(...c.added);
  report.gone.push(...c.gone);
  for (const u of c.updated) {
    if (u.before.price !== null && u.after.price !== null && u.after.price < u.before.price) report.priceDrops.push({ listing: u.after, from: u.before.price, to: u.after.price });
  }
}

export function formatSyncMessage(config: Config, r: SyncReport): string {
  const site = siteUrl(config);
  const lines: string[] = [`<b>${r.ok ? '🔄' : '⚠️'} Inventory sync</b> — ${r.totals.active} cars live`];
  for (const l of r.added) lines.push(`➕ <a href="${site}${listingPath(l)}">${esc(l.title)}</a> · ${formatPrice(l.price)}`);
  for (const p of r.priceDrops) lines.push(`📉 ${esc(p.listing.title)}: ${formatPrice(p.from)} → <b>${formatPrice(p.to)}</b>`);
  for (const g of r.gone) lines.push(`${g.status === 'sold' ? '✅ Sold' : '🚫 ' + g.status}: ${esc(g.listing.title)} · ${formatPrice(g.listing.price)} · ${daysBetween(g.listing.firstSeenAt, g.listing.soldAt ?? r.finishedAt)} days on site`);
  if (r.added.length + r.priceDrops.length + r.gone.length === 0) lines.push('No changes.');
  if (r.errors.length) lines.push(`\n⚠️ ${r.errors.length} error(s):\n` + r.errors.slice(0, 3).map((e) => `• ${esc(e)}`).join('\n'));
  return lines.join('\n');
}

async function notifySync(config: Config, report: SyncReport): Promise<void> {
  const token = secret('TELEGRAM_BOT_TOKEN');
  const chatId = config.contact.telegramChatId;
  if (!token || !chatId) { logger.debug('telegram not configured; skipping sync notification'); return; }
  try { await sendTelegram({ token, chatId }, formatSyncMessage(config, report)); }
  catch (err) { logger.warn('telegram notification failed', errorData(err)); }
}
