import { Env } from './types.js';

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

export const nowIso = (): string => new Date().toISOString();

/** CORS: only the dealership site (and localhost for development) may call the public endpoints. */
export function corsHeaders(env: Env, request: Request): Record<string, string> {
  const origin = request.headers.get('origin') ?? '';
  const allowed = allowedOrigin(env, origin);
  return {
    'access-control-allow-origin': allowed ? origin : siteOrigin(env),
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

export function siteOrigin(env: Env): string {
  try { return new URL(env.SITE_URL).origin; } catch { return ''; }
}

export function allowedOrigin(env: Env, origin: string): boolean {
  if (!origin) return false;
  if (origin === siteOrigin(env)) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
}

export interface Geo { country: string; region: string; city: string; }
export function geo(request: Request): Geo {
  const cf = (request as Request & { cf?: Record<string, unknown> }).cf ?? {};
  return { country: String(cf.country ?? ''), region: String(cf.region ?? cf.regionCode ?? ''), city: String(cf.city ?? '') };
}

export function device(ua: string): string {
  if (/bot|crawl|spider|slurp|facebookexternalhit|preview/i.test(ua)) return 'bot';
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) return 'tablet';
  if (/mobi|iphone|android/i.test(ua)) return 'mobile';
  return 'desktop';
}

export function referrerHost(ref: string, ownOrigin: string): string {
  if (!ref) return '';
  try {
    const u = new URL(ref);
    if (ownOrigin && u.origin === ownOrigin) return '';
    return u.hostname.replace(/^www\./, '');
  } catch { return ''; }
}

export const clip = (s: unknown, max: number): string => (typeof s === 'string' ? s : s == null ? '' : String(s)).trim().slice(0, max);

export const escHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function bearer(request: Request): string {
  const h = request.headers.get('authorization') ?? '';
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
}

/** Constant-time string compare. */
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
