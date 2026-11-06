// `drift` CLI entry. One file per command group under ./commands. Every command is thin:
// parse args → call a function in src/jobs, src/site, src/core → print.
import { Command } from 'commander';
import { setLogLevel } from '../core/logger.js';
import { registerSync } from './commands/sync.js';
import { registerSite } from './commands/site.js';
import { registerListings } from './commands/listings.js';
import { registerLogs } from './commands/logs.js';
import { registerStats } from './commands/stats.js';
import { registerLeads } from './commands/leads.js';
import { registerConfig } from './commands/config.js';
import { registerSchedule } from './commands/schedule.js';
import { registerContact } from './commands/contact.js';
import { registerWorker } from './commands/worker.js';
import { registerDigest } from './commands/digest.js';
import { registerDoctor } from './commands/doctor.js';
import { fail } from './ui.js';

const program = new Command();
program
  .name('drift')
  .description('Dealership website toolkit: KSL inventory sync, static site build, lead routing, analytics.')
  .version('0.1.0')
  .option('-v, --verbose', 'debug logging')
  .hook('preAction', (cmd) => { if (cmd.opts().verbose) setLogLevel('debug'); });

registerSync(program);
registerSite(program);
registerListings(program);
registerLogs(program);
registerStats(program);
registerLeads(program);
registerConfig(program);
registerSchedule(program);
registerContact(program);
registerWorker(program);
registerDigest(program);
registerDoctor(program);

program.parseAsync(process.argv).catch((err: Error) => {
  fail(err.message);
  if (process.env.DRIFT_LOG === 'debug') console.error(err.stack);
  process.exit(1);
});
