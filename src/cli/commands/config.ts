import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { ConfigSchema, getPath, loadConfig, saveConfig, setPath } from '../../core/config.js';
import { PATHS } from '../../core/paths.js';
import { die, ok, printJson } from '../ui.js';

export function registerConfig(program: Command): void {
  const cmd = program.command('config').description('Read and edit drift.config.json');
  cmd.command('show').description('Print the whole config').action(() => printJson(loadConfig()));
  cmd.command('get <path>').description('Print one value, e.g. contact.phone').action((p) => {
    const v = getPath(loadConfig(), p);
    if (v === undefined) die(`no such key: ${p}`);
    console.log(typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v));
  });
  cmd.command('set <path> <value>').description('Set one value (numbers/booleans/arrays coerced from the existing type)').action((p, value) => {
    const raw = JSON.parse(readFileSync(PATHS.config, 'utf8')) as Record<string, unknown>;
    setPath(raw, p, value);
    const parsed = ConfigSchema.safeParse(raw);
    if (!parsed.success) die(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    saveConfig(parsed.data);
    ok(`${p} = ${JSON.stringify(getPath(parsed.data, p))}`);
  });
  cmd.command('validate').description('Validate drift.config.json').action(() => { loadConfig(); ok('drift.config.json is valid'); });
}
