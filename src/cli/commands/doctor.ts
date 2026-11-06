// `drift doctor`: one screen that says what is configured, what is missing, and what to do.
import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { loadConfig } from '../../core/config.js';
import { secretStatus } from '../../core/env.js';
import { loadInventory } from '../../core/inventory.js';
import { PATHS } from '../../core/paths.js';
import { fail, heading, info, ok, warn } from '../ui.js';

export function registerDoctor(program: Command): void {
  program.command('doctor').description('Check configuration, secrets, data, and connectivity').action(async () => {
    let config;
    heading('Config');
    try { config = loadConfig(); ok('drift.config.json valid'); } catch (err) { fail((err as Error).message); return; }
    config.dealer.name ? ok(`dealer: ${config.dealer.name}`) : fail('dealer.name missing');
    config.sources.ksl.memberId ? ok(`KSL memberId: ${config.sources.ksl.memberId}`) : warn('sources.ksl.memberId empty → KSL sync disabled until set (drift config set sources.ksl.memberId <id>)');
    config.site.url ? ok(`site url: ${config.site.url}`) : warn('site.url empty (GitHub Pages URL is derived in CI; set it for local builds/links)');
    config.worker.url ? ok(`worker url: ${config.worker.url}`) : warn('worker.url empty → contact form and analytics disabled on the site');
    config.worker.d1DatabaseId ? ok('D1 database id set') : warn('worker.d1DatabaseId empty → run: drift worker create-db');
    config.contact.telegramChatId ? ok(`telegram chat: ${config.contact.telegramChatId}`) : warn('contact.telegramChatId empty (drift contact telegram-chat-id)');
    if (config.contact.methods.includes('email') && !config.contact.email) fail('contact.methods includes email but contact.email is empty');

    heading('Secrets (.env / environment)');
    const s = secretStatus();
    (['TELEGRAM_BOT_TOKEN', 'DRIFT_ADMIN_TOKEN', 'DRIFT_DASHBOARD_TOKEN'] as const).forEach((k) => (s[k] ? ok(k) : warn(`${k} missing`)));
    (['RESEND_API_KEY', 'TURNSTILE_SECRET_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'] as const).forEach((k) => (s[k] ? ok(k) : info(`${k} not set (optional${k.startsWith('CLOUDFLARE') ? ' locally; required for deploys' : ''})`)));

    heading('Data');
    if (existsSync(PATHS.inventory)) { const inv = loadInventory(); ok(`${inv.listings.length} active listings, synced ${inv.syncedAt ?? 'never'}`); } else warn('data/inventory.json missing → run: drift sync (or drift sync --mock)');

    heading('Tools');
    for (const [bin, args] of [['gh', ['--version']], ['node', ['--version']]] as const) {
      try { ok(`${bin} ${execFileSync(bin, [...args], { encoding: 'utf8' }).split('\n')[0]}`); } catch { warn(`${bin} not found`); }
    }

    if (config.worker.url) {
      heading('Worker');
      try {
        const res = await fetch(`${config.worker.url.replace(/\/+$/, '')}/health`);
        const h = (await res.json()) as Record<string, unknown>;
        (h.ok ? ok : fail)(`health ${res.status}: db=${h.db} telegram=${h.telegram} email=${h.email} turnstile=${h.turnstile} methods=${h.methods}`);
      } catch (err) { fail(`health check failed: ${(err as Error).message}`); }
    }
  });
}
