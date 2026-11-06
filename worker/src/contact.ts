// POST /contact — validates, rate-limits, stores the lead, fans out to Telegram/email.
import { sendLeadEmail } from './email.js';
import { fetchListings } from './listings.js';
import { sendLeadTelegram } from './telegram.js';
import { verifyTurnstile } from './turnstile.js';
import { Env, LeadInput } from './types.js';
import { clientIp, clip, geo, json, nowIso, sha256Hex } from './util.js';

export const MAX_LEADS_PER_HOUR = 5;

export type Validation = { ok: true; lead: LeadInput; turnstileToken: string } | { ok: false; error: string };

export function validateLead(body: unknown): Validation {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid request.' };
  const b = body as Record<string, unknown>;
  if (clip(b.website, 10)) return { ok: false, error: 'Rejected.' }; // honeypot filled → bot
  const lead: LeadInput = {
    name: clip(b.name, 100), phone: clip(b.phone, 40), email: clip(b.email, 120), message: clip(b.message, 2000),
    listingId: clip(b.listingId, 40).replace(/[^\w-]/g, ''), page: clip(b.page, 300), sid: clip(b.sid, 64),
  };
  if (lead.name.length < 2) return { ok: false, error: 'Please enter your name.' };
  if ((lead.phone.match(/\d/g) ?? []).length < 7) return { ok: false, error: 'Please enter a valid phone number.' };
  if (lead.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) return { ok: false, error: 'That email address does not look right.' };
  if (lead.message.length < 3) return { ok: false, error: 'Please write a short message.' };
  if (/https?:\/\/\S+.*https?:\/\/\S+.*https?:\/\//is.test(lead.message)) return { ok: false, error: 'Too many links in the message.' };
  return { ok: true, lead, turnstileToken: clip(b.turnstileToken, 4096) };
}

export async function deliverLead(env: Env, lead: LeadInput, where: string): Promise<{ delivered: string[]; errors: string[]; listingTitle: string }> {
  const listings = await fetchListings(env);
  const listing = lead.listingId ? listings.get(lead.listingId) : undefined;
  const methods = (env.CONTACT_METHODS || 'telegram').split(',').map((m) => m.trim()).filter(Boolean);
  const delivered: string[] = [];
  const errors: string[] = [];
  for (const m of methods) {
    try {
      if (m === 'telegram') await sendLeadTelegram(env, lead, listing, where);
      else if (m === 'email') await sendLeadEmail(env, lead, listing, where);
      else continue;
      delivered.push(m);
    } catch (err) {
      errors.push(`${m}: ${(err as Error).message}`);
    }
  }
  return { delivered, errors, listingTitle: listing?.title ?? '' };
}

export async function handleContact(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON.' }, 400, cors); }
  const v = validateLead(body);
  if (!v.ok) return json({ ok: false, error: v.error }, 400, cors);

  const ip = clientIp(request);
  const ipHash = (await sha256Hex(`${env.ADMIN_TOKEN ?? ''}:${ip}`)).slice(0, 24);
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM leads WHERE ip_hash = ? AND ts > ?').bind(ipHash, since).first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_LEADS_PER_HOUR) return json({ ok: false, error: 'Too many messages. Please call us instead.' }, 429, cors);

  if (!(await verifyTurnstile(env, v.turnstileToken, ip))) return json({ ok: false, error: 'Verification failed. Please try again.' }, 400, cors);

  const g = geo(request);
  const where = [g.city, g.region, g.country].filter(Boolean).join(', ');
  const result = await deliverLead(env, v.lead, where);
  await env.DB.prepare(
    'INSERT INTO leads (ts, name, phone, email, message, listing_id, listing_title, page, country, city, ip, ip_hash, delivered, errors) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).bind(nowIso(), v.lead.name, v.lead.phone, v.lead.email, v.lead.message, v.lead.listingId, result.listingTitle, v.lead.page, g.country, g.city, env.IP_MODE === 'full' ? ip : '', ipHash, result.delivered.join(','), result.errors.join(' | ')).run();

  if (result.delivered.length === 0) {
    console.error('lead stored but not delivered', result.errors);
    return json({ ok: false, error: 'We saved your message but could not notify the dealer. Please call us.' }, 502, cors);
  }
  return json({ ok: true, delivered: result.delivered.join(',') }, 200, cors);
}
