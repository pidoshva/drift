import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { loadConfig } from '../../core/config.js';
import { AdminClient } from '../../core/admin-client.js';
import { LogEntry } from '../../core/logger.js';
import { PATHS } from '../../core/paths.js';
import { dim, heading, printJson, table } from '../ui.js';

export function registerLogs(program: Command): void {
  program
    .command('logs')
    .description('Show logs: local CLI log (default), --remote worker jobs/events, --actions GitHub runs')
    .option('-n, --limit <n>', 'number of lines', (v) => parseInt(v, 10), 50)
    .option('--level <level>', 'min level for local logs: debug|info|warn|error', 'info')
    .option('--scope <scope>', 'filter local logs by scope prefix (e.g. sync, ksl)')
    .option('--remote', 'job runs + recent events recorded by the worker')
    .option('--type <type>', 'with --remote: event type filter (lead, pageview, listing_view, click_call…)')
    .option('--actions', 'recent GitHub Actions runs (needs gh)')
    .option('--json', 'JSON output')
    .action(async (opts) => {
      if (opts.actions) { execFileSync('gh', ['run', 'list', '--limit', String(opts.limit)], { stdio: 'inherit' }); return; }
      if (opts.remote) {
        const admin = AdminClient.fromConfig(loadConfig());
        if (opts.type === 'lead') { const r = await admin.leads(opts.limit); if (opts.json) printJson(r); else table(r.leads.map((l) => ({ ts: l.ts, name: l.name, phone: l.phone, car: l.listingTitle, delivered: l.delivered, msg: l.message.slice(0, 50) }))); return; }
        if (opts.type) { const r = await admin.events(opts.limit, opts.type); if (opts.json) printJson(r); else table(r.events); return; }
        const jobs = await admin.jobs(opts.limit);
        if (opts.json) { printJson(jobs); return; }
        heading('Job runs (worker record)');
        table(jobs.jobs.map((j) => ({ ts: j.ts, type: j.type, status: j.status, summary: JSON.stringify(j.summary).slice(0, 100) })));
        return;
      }
      if (!existsSync(PATHS.localLog)) { console.log(dim('no local log yet (.drift/drift.log)')); return; }
      const order: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40 };
      const min = order[opts.level] ?? 20;
      const lines = readFileSync(PATHS.localLog, 'utf8').trim().split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l) as LogEntry; } catch { return null; } })
        .filter((e): e is LogEntry => Boolean(e) && (order[e!.level] ?? 0) >= min && (!opts.scope || e!.scope.startsWith(opts.scope)))
        .slice(-opts.limit);
      if (opts.json) { printJson(lines); return; }
      for (const e of lines) console.log(`${dim(e.ts.replace('T', ' ').slice(0, 19))} ${e.level.toUpperCase().padEnd(5)} [${e.scope}] ${e.msg}${e.data ? ' ' + dim(JSON.stringify(e.data)) : ''}`);
    });
}
