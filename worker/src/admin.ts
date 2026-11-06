// /admin/* — read-only stats for the CLI and dashboard, plus job-event ingestion from CI.
// ADMIN_TOKEN: everything. DASHBOARD_TOKEN: GET /admin/stats only.
import { deliverLead } from './contact.js';
import { fetchListings } from './listings.js';
import { Env } from './types.js';
import { bearer, json, nowIso, safeEqual } from './util.js';

export type Role = 'admin' | 'dashboard' | null;

export function authorize(request: Request, env: Env): Role {
  const token = bearer(request);
  if (env.ADMIN_TOKEN && safeEqual(token, env.ADMIN_TOKEN)) return 'admin';
  if (env.DASHBOARD_TOKEN && safeEqual(token, env.DASHBOARD_TOKEN)) return 'dashboard';
  return null;
}

const clampInt = (v: string | null, def: number, min: number, max: number): number => {
  const n = parseInt(v ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

export async function handleStats(url: URL, env: Env): Promise<Response> {
  const days = clampInt(url.searchParams.get('days'), 30, 1, 365);
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const f = from.toISOString();
  const db = env.DB;
  const q = <T>(sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).all<T>().then((r) => r.results);

  const [totals, leadsTotal, daily, leadsDaily, topListings, leadsByListing, topReferrers, topPaths, countries, cities, devices, recentLeads, jobs] = await Promise.all([
    db.prepare(`SELECT
        SUM(CASE WHEN type IN ('pageview','listing_view') THEN 1 ELSE 0 END) AS pageviews,
        COUNT(DISTINCT CASE WHEN type IN ('pageview','listing_view') THEN ip_hash END) AS visitors,
        SUM(CASE WHEN type='listing_view' THEN 1 ELSE 0 END) AS listingViews,
        SUM(CASE WHEN type='click_call' THEN 1 ELSE 0 END) AS callClicks,
        SUM(CASE WHEN type='click_ksl' THEN 1 ELSE 0 END) AS kslClicks
      FROM events WHERE ts > ?`).bind(f).first<{ pageviews: number; visitors: number; listingViews: number; callClicks: number; kslClicks: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM leads WHERE ts > ?').bind(f).first<{ n: number }>(),
    q<{ day: string; pageviews: number; visitors: number; listingViews: number }>(`SELECT substr(ts,1,10) AS day,
        SUM(CASE WHEN type IN ('pageview','listing_view') THEN 1 ELSE 0 END) AS pageviews,
        COUNT(DISTINCT CASE WHEN type IN ('pageview','listing_view') THEN ip_hash END) AS visitors,
        SUM(CASE WHEN type='listing_view' THEN 1 ELSE 0 END) AS listingViews
      FROM events WHERE ts > ? GROUP BY day ORDER BY day`, f),
    q<{ day: string; leads: number }>('SELECT substr(ts,1,10) AS day, COUNT(*) AS leads FROM leads WHERE ts > ? GROUP BY day', f),
    q<{ listingId: string; views: number }>(`SELECT listing_id AS listingId, COUNT(*) AS views FROM events WHERE type='listing_view' AND listing_id != '' AND ts > ? GROUP BY listing_id ORDER BY views DESC LIMIT 25`, f),
    q<{ listingId: string; leads: number }>(`SELECT listing_id AS listingId, COUNT(*) AS leads FROM leads WHERE listing_id != '' AND ts > ? GROUP BY listing_id`, f),
    q<{ referrer: string; count: number }>(`SELECT referrer, COUNT(*) AS count FROM events WHERE type IN ('pageview','listing_view') AND ts > ? GROUP BY referrer ORDER BY count DESC LIMIT 15`, f),
    q<{ path: string; count: number }>(`SELECT path, COUNT(*) AS count FROM events WHERE type IN ('pageview','listing_view') AND ts > ? GROUP BY path ORDER BY count DESC LIMIT 15`, f),
    q<{ country: string; count: number }>(`SELECT country, COUNT(*) AS count FROM events WHERE type IN ('pageview','listing_view') AND ts > ? GROUP BY country ORDER BY count DESC LIMIT 15`, f),
    q<{ city: string; region: string; country: string; count: number }>(`SELECT city, region, country, COUNT(*) AS count FROM events WHERE type IN ('pageview','listing_view') AND ts > ? GROUP BY city, region, country ORDER BY count DESC LIMIT 20`, f),
    q<{ device: string; count: number }>(`SELECT device, COUNT(*) AS count FROM events WHERE type IN ('pageview','listing_view') AND ts > ? GROUP BY device ORDER BY count DESC`, f),
    q<Record<string, unknown>>(`SELECT id, ts, name, phone, email, message, listing_id AS listingId, listing_title AS listingTitle, country, city, delivered FROM leads WHERE ts > ? ORDER BY ts DESC LIMIT 20`, f),
    q<{ id: number; ts: string; type: string; status: string; summary: string }>('SELECT id, ts, type, status, summary FROM jobs ORDER BY ts DESC LIMIT 20'),
  ]);

  // Fill every day in range so charts have a continuous x axis.
  const dailyMap = new Map(daily.map((d) => [d.day, d]));
  const leadsMap = new Map(leadsDaily.map((d) => [d.day, d.leads]));
  const series: { day: string; pageviews: number; visitors: number; listingViews: number; leads: number }[] = [];
  for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86_400_000)) {
    const day = d.toISOString().slice(0, 10);
    const row = dailyMap.get(day);
    series.push({ day, pageviews: row?.pageviews ?? 0, visitors: row?.visitors ?? 0, listingViews: row?.listingViews ?? 0, leads: leadsMap.get(day) ?? 0 });
  }
  const listings = await fetchListings(env);
  const leadsFor = new Map(leadsByListing.map((l) => [l.listingId, l.leads]));

  return json({
    days, from: f, to: to.toISOString(),
    totals: { pageviews: totals?.pageviews ?? 0, visitors: totals?.visitors ?? 0, listingViews: totals?.listingViews ?? 0, leads: leadsTotal?.n ?? 0, callClicks: totals?.callClicks ?? 0, kslClicks: totals?.kslClicks ?? 0 },
    daily: series,
    topListings: topListings.map((t) => ({ listingId: t.listingId, title: listings.get(t.listingId)?.title ?? '', views: t.views, leads: leadsFor.get(t.listingId) ?? 0 })),
    topReferrers, topPaths, countries, cities, devices, recentLeads,
    jobs: jobs.map((j) => ({ ...j, summary: safeJson(j.summary) })),
  });
}

const safeJson = (s: string): unknown => { try { return JSON.parse(s); } catch { return {}; } };

export async function handleAdmin(request: Request, url: URL, env: Env, role: Role): Promise<Response> {
  const path = url.pathname;
  if (path === '/admin/stats' && request.method === 'GET') return handleStats(url, env);
  if (role !== 'admin') return json({ error: 'forbidden' }, 403);
  const limit = clampInt(url.searchParams.get('limit'), 50, 1, 500);
  if (path === '/admin/leads' && request.method === 'GET') {
    const r = await env.DB.prepare('SELECT id, ts, name, phone, email, message, listing_id AS listingId, listing_title AS listingTitle, page, country, city, ip, delivered, errors FROM leads ORDER BY ts DESC LIMIT ?').bind(limit).all();
    return json({ leads: r.results });
  }
  if (path === '/admin/events' && request.method === 'GET') {
    const type = url.searchParams.get('type');
    const stmt = type
      ? env.DB.prepare('SELECT id, ts, type, path, listing_id AS listingId, referrer, country, region, city, ip, device, session_id AS sessionId FROM events WHERE type = ? ORDER BY ts DESC LIMIT ?').bind(type, limit)
      : env.DB.prepare('SELECT id, ts, type, path, listing_id AS listingId, referrer, country, region, city, ip, device, session_id AS sessionId FROM events ORDER BY ts DESC LIMIT ?').bind(limit);
    return json({ events: (await stmt.all()).results });
  }
  if (path === '/admin/jobs' && request.method === 'GET') {
    const r = await env.DB.prepare('SELECT id, ts, type, status, summary FROM jobs ORDER BY ts DESC LIMIT ?').bind(limit).all<{ summary: string }>();
    return json({ jobs: r.results.map((j) => ({ ...j, summary: safeJson(j.summary) })) });
  }
  if (path === '/admin/jobs' && request.method === 'POST') {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const type = String(b.type ?? '').slice(0, 32);
    const status = String(b.status ?? 'ok').slice(0, 16);
    if (!type) return json({ error: 'type required' }, 400);
    await env.DB.prepare('INSERT INTO jobs (ts, type, status, summary) VALUES (?,?,?,?)').bind(nowIso(), type, status, JSON.stringify(b.summary ?? {}).slice(0, 8000)).run();
    return json({ ok: true });
  }
  if (path === '/admin/test-contact' && request.method === 'POST') {
    const r = await deliverLead(env, { name: 'Drift test', phone: '801-555-0100', email: 'test@example.com', message: 'This is a test lead sent by `drift contact test`. If you can read this, lead routing works.', listingId: '', page: '', sid: 'test' }, 'drift CLI');
    await env.DB.prepare('INSERT INTO jobs (ts, type, status, summary) VALUES (?,?,?,?)').bind(nowIso(), 'test-contact', r.delivered.length ? 'ok' : 'error', JSON.stringify(r)).run();
    return json({ ok: r.delivered.length > 0, delivered: r.delivered.join(','), errors: r.errors }, r.delivered.length ? 200 : 502);
  }
  return json({ error: 'not found' }, 404);
}
