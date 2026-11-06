import { Command } from 'commander';
import { loadConfig } from '../../core/config.js';
import { AdminClient } from '../../core/admin-client.js';
import { secret } from '../../core/env.js';
import { buildDigest, formatDigest } from '../../jobs/digest.js';
import { sendTelegram } from '../../notify/telegram.js';
import { postJobEvent } from '../../jobs/events.js';
import { die, ok, warn } from '../ui.js';

export function registerDigest(program: Command): void {
  program
    .command('digest')
    .description('Build the daily business summary (prints it; --send posts to Telegram)')
    .option('-d, --days <n>', 'window', (v) => parseInt(v, 10), 1)
    .option('--send', 'send to the configured Telegram chat')
    .action(async (opts) => {
      const config = loadConfig();
      let admin: AdminClient | null = null;
      try { admin = AdminClient.fromConfig(config); } catch (err) { warn(`worker not configured: ${(err as Error).message}`); }
      const data = await buildDigest(config, admin, opts.days);
      const text = formatDigest(config, data, opts.days === 1 ? 'Yesterday' : `Last ${opts.days} days`);
      console.log(text.replace(/<[^>]+>/g, ''));
      if (!opts.send) return;
      const token = secret('TELEGRAM_BOT_TOKEN');
      if (!token || !config.contact.telegramChatId) die('TELEGRAM_BOT_TOKEN and contact.telegramChatId are required to send');
      const sent = await sendTelegram({ token, chatId: config.contact.telegramChatId }, text);
      await postJobEvent(config, 'digest', sent ? 'ok' : 'error', { days: opts.days, stats: Boolean(data.stats) });
      if (!sent) die('Telegram rejected the message');
      ok('digest sent');
    });
}
