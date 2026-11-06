import { Command } from 'commander';
import { loadConfig, saveConfig } from '../../core/config.js';
import { AdminClient } from '../../core/admin-client.js';
import { requireSecret } from '../../core/env.js';
import { recentChats } from '../../notify/telegram.js';
import { die, info, ok, table, warn } from '../ui.js';

export function registerContact(program: Command): void {
  const cmd = program.command('contact').description('Where website messages go (phone, email, Telegram) and testing the route');
  cmd.command('show').description('Show routing').action(() => {
    const c = loadConfig().contact;
    info(`phone:     ${c.phone || '(none)'}`);
    info(`email:     ${c.email || '(none)'}`);
    info(`telegram:  ${c.telegramChatId || '(none)'}`);
    info(`methods:   ${c.methods.join(', ')}`);
    info(`turnstile: ${c.turnstileSiteKey ? 'on' : 'off'}`);
  });
  cmd.command('set <field> <value>')
    .description('field = phone | email | telegram | methods (comma list of telegram,email)')
    .action((field: string, value: string) => {
      const c = loadConfig();
      if (field === 'phone') c.contact.phone = value;
      else if (field === 'email') c.contact.email = value;
      else if (field === 'telegram') c.contact.telegramChatId = value;
      else if (field === 'methods') c.contact.methods = value.split(',').map((s) => s.trim()).filter((s): s is 'telegram' | 'email' => s === 'telegram' || s === 'email');
      else die('field must be phone | email | telegram | methods');
      saveConfig(c);
      ok(`contact.${field} updated. Run \`drift deploy worker\` (or push) so the worker picks it up.`);
    });
  cmd.command('telegram-chat-id')
    .description('List chats that messaged the bot (send /start to the bot first), to find the chat id')
    .action(async () => {
      const chats = await recentChats(requireSecret('TELEGRAM_BOT_TOKEN', 'to query the bot'));
      if (!chats.length) warn('No chats yet. Open the bot in Telegram, press Start, send any message, then rerun.');
      else { table(chats); info('Then: drift contact set telegram <id>'); }
    });
  cmd.command('test')
    .description('Send a test lead through the deployed worker to every configured method')
    .action(async () => {
      const r = await AdminClient.fromConfig(loadConfig()).testContact();
      if (r.ok) ok(`delivered via ${r.delivered}`); else die(`not delivered: ${JSON.stringify(r)}`);
    });
}
