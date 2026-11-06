// The sync job: pull inventory from every enabled source, merge into data/, report.
// Runs on a schedule in GitHub Actions (`.github/workflows/sync.yml`) and locally via `drift sync`.
import { existsSync } from 'node:fs';
import { Config, siteUrl } from '../core/config.js';
import { secret } from '../core/env.js';
import { Listing, ListingStatus, daysBetween, formatPrice, listingPath } from '../core/listing.js';
import { SyncChanges, applyChanges, loadArchive, loadInventory, mergeSnapshot, summarizeChanges, writeInventoryFile } from '../core/inventory.js';
import { errorData, log } from '../core/logger.js';
import { PATHS } from '../core/paths.js';
import { GoneResolution, InventorySource, ListingSummary } from '../sources/source.js';
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
  /** data/ files were rewritten. False on dry runs and on quiet runs where nothing real changed. */
  wrote: boolean;
  perSource: Record<string, Record<string, number>>;
  totals: { active: number; added: number; updated: number; gone: number; detailFetches: number; errors: number; warnings: number };
  added: Listing[];
  gone: { listing: Listing; status: ListingStatus }[];
  priceDrops: { listing: Listing; from: number | null; to: number | null }[];
  /** Missing from the source but the gone check was inconclusive; kept live, re-checked next run. */
  unverified: { listing: Listing; reason: string }[];
  /** A source failed entirely (its previous inventory was kept). Makes `ok` false and the CLI exit non-zero. */
  errors: string[];
  /** Per-listing problems (detail fetch or gone check failed); data was still written. */
  warnings: string[];
}

export async function runSync(config: Config, opts: SyncOptions): Promise<SyncReport> {
  const now = opts.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const t0 = Date.now();
  const inventory = loadInventory();
  const archive = loadArchive();
  const report: SyncReport = {
    startedAt, finishedAt: startedAt, durationMs: 0, ok: true, dryRun: Boolean(opts.dryRun), wrote: false, perSource: {},
    totals: { active: 0, added: 0, updated: 0, gone: 0, detailFetches: 0, errors: 0, warnings: 0 }, added: [], gone: [], priceDrops: [], unverified: [], errors: [], warnings: [],
  };
  const nextActive: Listing[] = [];
  const nextArchive: Listing[] = [...archive.listings];
  const locked = new Set(archive.listings.filter((l) => l.statusLockedAt).map((l) => l.id));
  const refreshMs = config.sources.ksl.detailRefreshHours * 3_600_000;

  for (const source of opts.sources) {
    const slog = logger.child(source.name);
    const current = inventory.listings.filter((l) => l.source === source.name);
    const currentById = new Map(current.map((l) => [l.id, l]));
    let summaries: ListingSummary[];
    try {
      summaries = (await source.listSummaries()).filter((s) => {
        if (!locked.has(s.id)) return true;
        slog.info('skipping listing marked by hand; still archived', { id: s.id });
        return false;
      });
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
      if (s.complete) {
        fresh.push(before && before.hash === s.partial.hash ? { ...s.partial, detailFetchedAt: before.detailFetchedAt } : s.partial);
        continue;
      }
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
          report.warnings.push(`${source.name}:${s.id}: ${(err as Error).message}`);
        }
      }
      fresh.push(before ? refreshFromSummary(before, s.partial) : s.partial);
    }
    report.totals.detailFetches += fetched;

    const goneStatus = new Map<string, ListingStatus>();
    for (const l of current) {
      if (summaries.some((s) => s.id === l.id)) continue;
      let resolution: GoneResolution;
      try { resolution = await source.resolveGone(l); }
      catch (err) { resolution = { status: 'active', unresolved: (err as Error).message }; }
      goneStatus.set(l.id, resolution.status);
      if (resolution.unresolved) {
        slog.warn('could not verify missing listing; kept live until the next run', { id: l.id, reason: resolution.unresolved });
        report.unverified.push({ listing: l, reason: resolution.unresolved });
      }
    }
    const changes = mergeSnapshot(current, fresh, (l) => goneStatus.get(l.id) ?? 'active', now());
    report.perSource[source.name] = summarizeChanges(changes);
    collect(report, changes);
    nextActive.push(...applyChanges(changes));
    nextArchive.push(...changes.gone.map((g) => g.listing));
    slog.info('merged', report.perSource[source.name]);
  }

  // Sources disabled in config: their cars stay as they were.
  const handled = new Set(opts.sources.map((s) => s.name));
  nextActive.push(...inventory.listings.filter((l) => !handled.has(l.source)));

  // A car that came back under the same id lives in inventory only, never in both files.
  const activeIds = new Set(nextActive.map((l) => l.id));
  const archived = nextArchive.filter((l) => !activeIds.has(l.id));

  report.totals.active = nextActive.length;
  report.totals.errors = report.errors.length;
  report.totals.warnings = report.warnings.length + report.unverified.length;
  report.ok = report.errors.length === 0;
  report.finishedAt = now();
  report.durationMs = Date.now() - t0;

  const changed = !existsSync(PATHS.inventory) || !existsSync(PATHS.archive)
    || inventoryKey(inventory.listings) !== inventoryKey(nextActive)
    || inventoryKey(archive.listings) !== inventoryKey(archived);
  if (opts.dryRun) {
    logger.info('dry run: nothing written', { ...report.totals, changed });
  } else if (changed) {
    writeInventoryFile(PATHS.inventory, { version: 1, syncedAt: report.finishedAt, listings: nextActive });
    writeInventoryFile(PATHS.archive, { version: 1, syncedAt: report.finishedAt, listings: archived });
    report.wrote = true;
    logger.info('inventory written', { active: nextActive.length, archived: archived.length });
  } else {
    logger.info('no inventory changes; data/ left untouched', report.totals);
  }

  if (opts.notify !== false && !opts.dryRun) {
    await postJobEvent(config, 'sync', report.ok ? 'ok' : 'error', {
      ...report.totals, perSource: report.perSource, durationMs: report.durationMs,
      errors: report.errors.slice(0, 5), warnings: report.warnings.slice(0, 5), wrote: report.wrote,
      unverified: report.unverified.slice(0, 5).map((u) => `${u.listing.id}: ${u.reason}`),
    });
    if (shouldNotify(config, report)) await notifySync(config, report);
  }
  return report;
}

/**
 * Fingerprint of what the site and the gone check actually depend on. Timestamps that merely
 * say "seen again" (lastSeenAt, syncedAt) and search-row stats are left out so a quiet run
 * produces no file change, no bot commit and no redeploy.
 */
export function inventoryKey(listings: Listing[]): string {
  return listings
    .map((l) => [l.id, l.hash, l.status, l.detailFetchedAt, l.sourceExpiresAt, l.statusLockedAt].join('|'))
    .sort()
    .join('\n');
}

/**
 * Whether this run deserves a Telegram message. `changes` mode fires on any add/update/sale,
 * on a source failure, and whenever a missing car could not be verified (so a persistent
 * KSL problem is never silent).
 */
export function shouldNotify(config: Config, r: Pick<SyncReport, 'ok' | 'totals' | 'unverified'>): boolean {
  const mode = config.sync.notify;
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  const changed = r.totals.added + r.totals.updated + r.totals.gone > 0;
  return changed || !r.ok || r.unverified.length > 0;
}

/**
 * A listing we already hold details for was seen again on the search page but needs no
 * re-fetch. Search rows carry only a handful of fields, so keep everything from `before`
 * and refresh just what the row reliably reports; empty/null row values never win.
 */
export function refreshFromSummary(before: Listing, summary: Listing): Listing {
  return {
    ...before,
    title: summary.title || before.title,
    price: summary.price,
    mileage: summary.mileage ?? before.mileage,
    condition: summary.condition || before.condition,
    photos: before.photos.length ? before.photos : summary.photos,
    sourceStats: {
      pageViews: summary.sourceStats.pageViews ?? before.sourceStats.pageViews,
      favorites: summary.sourceStats.favorites ?? before.sourceStats.favorites,
    },
    sourceUpdatedAt: summary.sourceUpdatedAt ?? before.sourceUpdatedAt,
    sourceExpiresAt: summary.sourceExpiresAt ?? before.sourceExpiresAt,
    lastSeenAt: summary.lastSeenAt,
  };
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
  if (r.unverified.length) lines.push(`\n⚠️ ${r.unverified.length} listing(s) could not be verified and stay live:\n` + r.unverified.slice(0, 3).map((u) => `• ${esc(u.listing.title)} — ${esc(u.reason)}`).join('\n'));
  if (r.errors.length) lines.push(`\n⚠️ ${r.errors.length} error(s):\n` + r.errors.slice(0, 3).map((e) => `• ${esc(e)}`).join('\n'));
  if (r.warnings.length) lines.push(`\n${r.warnings.length} warning(s):\n` + r.warnings.slice(0, 3).map((e) => `• ${esc(e)}`).join('\n'));
  return lines.join('\n');
}

async function notifySync(config: Config, report: SyncReport): Promise<void> {
  const token = secret('TELEGRAM_BOT_TOKEN');
  const chatId = config.contact.telegramChatId;
  if (!token || !chatId) { logger.debug('telegram not configured; skipping sync notification'); return; }
  try { await sendTelegram({ token, chatId }, formatSyncMessage(config, report)); }
  catch (err) { logger.warn('telegram notification failed', errorData(err)); }
}
