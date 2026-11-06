import { Env, LeadInput, PublicListing } from './types.js';
import { escHtml } from './util.js';

const base = (env: Env) => (env.TELEGRAM_API_BASE ?? 'https://api.telegram.org').replace(/\/+$/, '');

export function leadCaption(env: Env, lead: LeadInput, listing: PublicListing | undefined, where: string): string {
  const site = env.SITE_URL.replace(/\/+$/, '');
  const lines = [listing ? `🚗 <b>New lead: ${escHtml(listing.title)}</b>${listing.price ? ` — $${Math.round(listing.price).toLocaleString('en-US')}` : ''}` : `💬 <b>New website message</b>`];
  lines.push(`👤 ${escHtml(lead.name)}`);
  lines.push(`📞 ${escHtml(lead.phone)}`);
  if (lead.email) lines.push(`✉️ ${escHtml(lead.email)}`);
  lines.push('', escHtml(lead.message));
  if (where) lines.push('', `📍 ${escHtml(where)}`);
  if (listing) lines.push(`🔗 <a href="${site}${listing.path}">On the website</a>${listing.url ? ` · <a href="${listing.url}">On KSL</a>` : ''}`);
  return lines.join('\n');
}

export async function sendLeadTelegram(env: Env, lead: LeadInput, listing: PublicListing | undefined, where: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) throw new Error('telegram not configured');
  const caption = leadCaption(env, lead, listing, where);
  const photo = listing?.photo && /^https?:\/\//.test(listing.photo) ? listing.photo : null;
  const method = photo ? 'sendPhoto' : 'sendMessage';
  const body: Record<string, unknown> = photo
    ? { chat_id: env.TELEGRAM_CHAT_ID, photo, caption: caption.slice(0, 1024), parse_mode: 'HTML' }
    : { chat_id: env.TELEGRAM_CHAT_ID, text: caption.slice(0, 4096), parse_mode: 'HTML', disable_web_page_preview: true };
  let res = await fetch(`${base(env)}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok && photo) {
    // Photo URL rejected (hotlink blocked, too big…) → fall back to a plain message.
    res = await fetch(`${base(env)}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: caption, parse_mode: 'HTML', disable_web_page_preview: true }) });
  }
  if (!res.ok) throw new Error(`telegram ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export async function sendTextTelegram(env: Env, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) throw new Error('telegram not configured');
  const res = await fetch(`${base(env)}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }) });
  if (!res.ok) throw new Error(`telegram ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
