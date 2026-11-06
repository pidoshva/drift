import { Command } from 'commander';
import { loadConfig } from '../../core/config.js';
import { AdminClient } from '../../core/admin-client.js';
import { printJson, table } from '../ui.js';

export function registerLeads(program: Command): void {
  program
    .command('leads')
    .description('Recent website leads (name, phone, car, message) recorded by the worker')
    .option('-n, --limit <n>', 'how many', (v) => parseInt(v, 10), 20)
    .option('--json', 'JSON output')
    .action(async (opts) => {
      const r = await AdminClient.fromConfig(loadConfig()).leads(opts.limit);
      if (opts.json) { printJson(r.leads); return; }
      table(r.leads.map((l) => ({ when: l.ts.slice(0, 16).replace('T', ' '), name: l.name, phone: l.phone, email: l.email, car: l.listingTitle || '—', via: l.delivered || 'FAILED', message: l.message })));
    });
}
