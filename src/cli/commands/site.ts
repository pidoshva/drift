import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../../core/config.js';
import { PATHS } from '../../core/paths.js';
import { buildSite } from '../../site/build.js';
import { serveStatic } from '../../site/serve.js';
import { info, ok } from '../ui.js';

export function registerSite(program: Command): void {
  program
    .command('build')
    .description('Build the static site from data/ into dist/')
    .option('--out <dir>', 'output directory', PATHS.dist)
    .action((opts) => {
      const r = buildSite(loadConfig(), { outDir: opts.out });
      ok(`built ${r.pages} pages (${r.listings} cars, ${r.sold} recently sold) in ${r.ms}ms → ${r.outDir}`);
    });

  program
    .command('serve')
    .description('Preview dist/ locally (builds first unless --no-build)')
    .option('-p, --port <port>', 'port', (v) => parseInt(v, 10), 4321)
    .option('--no-build', 'serve the existing dist/')
    .action(async (opts) => {
      if (opts.build) buildSite(loadConfig());
      await serveStatic(PATHS.dist, opts.port);
      info('Ctrl+C to stop');
    });

  const deploy = program.command('deploy').description('Deploy the site or the worker');
  deploy
    .command('site')
    .description('Trigger the GitHub Actions sync+deploy workflow (same as `drift sync --remote`)')
    .action(() => { execFileSync('gh', ['workflow', 'run', 'sync.yml'], { stdio: 'inherit' }); ok('triggered sync.yml (builds and deploys GitHub Pages)'); });
  deploy
    .command('worker')
    .description('Deploy the Cloudflare Worker with vars from drift.config.json')
    .action(async () => { const { deployWorker } = await import('./worker.js'); await deployWorker(); });
}
