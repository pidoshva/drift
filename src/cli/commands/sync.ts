import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../../core/config.js';
import { formatPrice } from '../../core/listing.js';
import { runSync } from '../../jobs/sync.js';
import { buildSources } from '../../sources/index.js';
import { KslClient } from '../../sources/ksl/client.js';
import { KslSource } from '../../sources/ksl/index.js';
import { createMockKslFetch, mockFromEnv } from '../../sources/ksl/mock.js';
import { ManualSource } from '../../sources/manual.js';
import { fail, heading, info, ok, printJson, table, warn } from '../ui.js';

export function registerSync(program: Command): void {
  program
    .command('sync')
    .description('Pull inventory from KSL (and data/manual) into data/, then report changes')
    .option('--dry-run', 'fetch and diff but write nothing')
    .option('--limit <n>', 'fetch details for at most N listings', (v) => parseInt(v, 10))
    .option('--source <name>', 'only this source: ksl | manual')
    .option('--force', 're-fetch every detail page')
    .option('--no-notify', 'skip Telegram / worker job event')
    .option('--mock', 'use the built-in mock KSL (tests/fixtures/mock-ksl-listings.json)')
    .option('--remote', 'trigger the GitHub Actions sync workflow instead of running locally')
    .option('--json', 'print the report as JSON')
    .action(async (opts) => {
      if (opts.remote) {
        execFileSync('gh', ['workflow', 'run', 'sync.yml'], { stdio: 'inherit' });
        ok('Triggered sync.yml on GitHub Actions. Watch it with: gh run watch');
        return;
      }
      const config = loadConfig();
      const useMock = opts.mock || process.env.DRIFT_MOCK_KSL === '1';
      const sources = useMock
        ? [
            ...(!opts.source || opts.source === 'ksl' ? [new KslSource({ memberId: config.sources.ksl.memberId || 'mock', maxPages: 25, client: new KslClient({ delayMs: 0, fetchImpl: createMockKslFetch(mockFromEnv()) }) })] : []),
            ...(!opts.source || opts.source === 'manual' ? [new ManualSource()] : []),
          ]
        : buildSources(config, opts.source);
      if (useMock) warn('MOCK mode: no requests go to KSL');
      if (!sources.length) fail('no sources enabled');
      const report = await runSync(config, { sources, dryRun: opts.dryRun, limit: opts.limit, force: opts.force, notify: opts.notify });
      if (opts.json) { printJson(report); return; }
      heading(`Sync ${report.ok ? 'finished' : 'finished with errors'} in ${(report.durationMs / 1000).toFixed(1)}s${report.dryRun ? ' (dry run)' : ''}`);
      table(Object.entries(report.perSource).map(([source, s]) => ({ source, ...s })));
      info(`${report.totals.active} active · ${report.totals.detailFetches} detail fetches${report.totals.warnings ? ` · ${report.totals.warnings} warning(s)` : ''}`);
      for (const l of report.added) ok(`added   ${l.title} ${formatPrice(l.price)}`);
      for (const p of report.priceDrops) info(`price   ${p.listing.title} ${formatPrice(p.from)} → ${formatPrice(p.to)}`);
      for (const g of report.gone) warn(`${g.status.padEnd(7)} ${g.listing.title}`);
      for (const u of report.unverified) warn(`unverified ${u.listing.title} (${u.reason}) — kept live`);
      for (const w of report.warnings) warn(w);
      for (const e of report.errors) fail(e);
      if (!report.ok) process.exitCode = 1;
    });
}
