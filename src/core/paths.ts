// Central place for every file path the system reads or writes.
// Nothing else in the codebase should hard-code a path.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export const PATHS = {
  root: ROOT,
  config: join(ROOT, 'drift.config.json'),
  envFile: join(ROOT, '.env'),
  data: join(ROOT, 'data'),
  inventory: join(ROOT, 'data', 'inventory.json'),
  archive: join(ROOT, 'data', 'archive.json'),
  manualDir: join(ROOT, 'data', 'manual'),
  localState: join(ROOT, '.drift'),
  localLog: join(ROOT, '.drift', 'drift.log'),
  dist: join(ROOT, 'dist'),
  theme: join(ROOT, 'src', 'site', 'theme'),
  client: join(ROOT, 'src', 'site', 'client'),
  workerDir: join(ROOT, 'worker'),
  wranglerToml: join(ROOT, 'worker', 'wrangler.toml'),
  syncWorkflow: join(ROOT, '.github', 'workflows', 'sync.yml'),
} as const;
