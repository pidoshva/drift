// POST /e — stores one analytics event. Fire-and-forget from the browser (sendBeacon).
import { Env } from './types.js';
import { clientIp, clip, device, geo, json, nowIso, referrerHost, sha256Hex, siteOrigin } from './util.js';

export const EVENT_TYPES = new Set(['pageview', 'listing_view', 'click_call', 'click_ksl', 'click_carfax', 'contact_submit']);
export const MAX_EVENTS_PER_MINUTE = 120;

export async function handleEvent(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return json({ ok: false }, 400, cors); }
  const type = clip(body.t, 32);
  if (!EVENT_TYPES.has(type)) return json({ ok: false }, 400, cors);
  const ua = request.headers.get('user-agent') ?? '';
  const dev = device(ua);
  if (dev === 'bot') return json({ ok: true, ignored: 'bot' }, 200, cors);

  const ip = clientIp(request);
  const ipHash = (await sha256Hex(`${env.ADMIN_TOKEN ?? ''}:${ip}`)).slice(0, 24);
  const since = new Date(Date.now() - 60_000).toISOString();
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM events WHERE ip_hash = ? AND ts > ?').bind(ipHash, since).first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_EVENTS_PER_MINUTE) return json({ ok: false, error: 'rate' }, 429, cors);

  const g = geo(request);
  await env.DB.prepare(
    'INSERT INTO events (ts, type, path, listing_id, referrer, country, region, city, ip, ip_hash, device, session_id, user_agent) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).bind(nowIso(), type, clip(body.p, 300), clip(body.l, 40), referrerHost(clip(body.r, 500), siteOrigin(env)), g.country, g.region, g.city, env.IP_MODE === 'full' ? ip : '', ipHash, dev, clip(body.s, 64), clip(ua, 200)).run();
  return json({ ok: true }, 200, cors);
}
