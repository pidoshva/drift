import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, saveConfig } from '../../core/config.js';
import { PATHS } from '../../core/paths.js';
import { die, info, ok } from '../ui.js';

const WORKFLOWS = { sync: join(PATHS.root, '.github', 'workflows', 'sync.yml'), digest: join(PATHS.root, '.github', 'workflows', 'digest.yml') } as const;

// Converts "2h" → every 2 hours, "30m" → every 30 minutes, "1d" → daily at 09:17 UTC (minute offset avoids the :00 rush).
export function everyToCron(every: string): string {
  const m = /^(\d+)\s*(m|h|d)$/i.exec(every.trim());
  if (!m) throw new Error(`invalid interval "${every}" (use e.g. 30m, 2h, 1d)`);
  const n = parseInt(m[1]!, 10);
  const unit = m[2]!.toLowerCase();
  if (unit === 'm') { if (n < 5 || 60 % n !== 0) throw new Error('minutes must divide 60 and be >= 5'); return `*/${n} * * * *`; }
  if (unit === 'h') { if (n < 1 || n > 23) throw new Error('hours must be 1-23'); return `17 */${n} * * *`; }
  if (n !== 1) throw new Error('only 1d is supported for days; use a cron expression for others');
  return '17 9 * * *';
}

/** Rewrites the cron on the line tagged `# drift:<job>-cron` in a workflow file. */
export function setWorkflowCron(file: string, job: keyof typeof WORKFLOWS, cron: string): void {
  const src = readFileSync(file, 'utf8');
  const re = new RegExp(`(- cron: )['"][^'"]*['"](\\s*# drift:${job}-cron)`);
  if (!re.test(src)) throw new Error(`marker "# drift:${job}-cron" not found in ${file}`);
  writeFileSync(file, src.replace(re, `$1'${cron}'$2`));
}

export function registerSchedule(program: Command): void {
  const cmd = program.command('schedule').description('View or change when the sync and digest jobs run (GitHub Actions cron, UTC)');
  cmd.command('show').description('Show current schedules').action(() => {
    const c = loadConfig();
    info(`sync:   ${c.sync.cron}   (UTC)`);
    info(`digest: ${c.digest.cron}   (UTC)${c.digest.enabled ? '' : '  [disabled]'}`);
  });
  cmd.command('set <job>')
    .description('Change a schedule: job = sync | digest')
    .option('--every <interval>', 'e.g. 30m, 2h, 1d')
    .option('--cron <expr>', 'raw cron expression (UTC)')
    .action((job: string, opts) => {
      if (job !== 'sync' && job !== 'digest') die('job must be sync or digest');
      const cron = opts.cron ?? (opts.every ? everyToCron(opts.every) : die('pass --every or --cron'));
      if (!/^(\S+\s+){4}\S+$/.test(cron)) die(`"${cron}" is not a 5-field cron expression`);
      const c = loadConfig();
      if (job === 'sync') c.sync.cron = cron; else c.digest.cron = cron;
      saveConfig(c);
      setWorkflowCron(WORKFLOWS[job], job, cron);
      ok(`${job} schedule → '${cron}' (UTC). Commit and push to apply.`);
    });
}
