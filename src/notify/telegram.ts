// Minimal Telegram Bot API client used by the CLI/jobs (sync reports, digest, tests).
// The worker has its own copy in worker/src/telegram.ts because it cannot import Node code.
import { log } from '../core/logger.js';

const logger = log('telegram');

export interface TelegramOptions {
  token: string;
  chatId: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

export async function sendTelegram(opts: TelegramOptions, text: string, extra: Record<string, unknown> = {}): Promise<boolean> {
  const base = opts.apiBase ?? process.env.TELEGRAM_API_BASE ?? 'https://api.telegram.org';
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`${base}/bot${opts.token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: opts.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra }),
  });
  if (!res.ok) {
    logger.warn('sendMessage failed', { status: res.status, body: (await res.text()).slice(0, 300) });
    return false;
  }
  return true;
}

/** Lists chats that have messaged the bot recently; used by `drift contact telegram-chat-id`. */
export async function recentChats(token: string, apiBase = process.env.TELEGRAM_API_BASE ?? 'https://api.telegram.org'): Promise<{ id: string; title: string; type: string }[]> {
  const res = await fetch(`${base(apiBase)}/bot${token}/getUpdates`);
  const json = (await res.json()) as { ok: boolean; result?: { message?: { chat: { id: number; type: string; title?: string; first_name?: string; username?: string } } }[] };
  const seen = new Map<string, { id: string; title: string; type: string }>();
  for (const u of json.result ?? []) {
    const chat = u.message?.chat;
    if (!chat) continue;
    seen.set(String(chat.id), { id: String(chat.id), title: chat.title ?? [chat.first_name, chat.username && `@${chat.username}`].filter(Boolean).join(' '), type: chat.type });
  }
  return [...seen.values()];
}
const base = (s: string) => s.replace(/\/+$/, '');

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
