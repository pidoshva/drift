// Worker unit tests: pure functions only (validation, formatting, auth, utils).
import { describe, expect, it } from 'vitest';
import { validateLead } from '../worker/src/contact.js';
import { leadCaption } from '../worker/src/telegram.js';
import { authorize } from '../worker/src/admin.js';
import { allowedOrigin, device, referrerHost, safeEqual, sha256Hex } from '../worker/src/util.js';
import type { Env } from '../worker/src/types.js';

const env = { SITE_URL: 'https://user.github.io/drift', DEALER_NAME: 'Demo', TELEGRAM_CHAT_ID: '1', CONTACT_EMAIL: '', CONTACT_FROM_EMAIL: '', CONTACT_METHODS: 'telegram', IP_MODE: 'hash', ADMIN_TOKEN: 'admin-secret', DASHBOARD_TOKEN: 'dash-secret' } as unknown as Env;

describe('validateLead', () => {
  const good = { name: 'Ann', phone: '801-555-0100', email: 'a@b.co', message: 'Still available?', listingId: '123', page: 'https://x/y', sid: 's' };
  it('accepts a good lead and trims/clips', () => {
    const v = validateLead({ ...good, name: '  Ann  ', listingId: '12<3>' });
    expect(v.ok).toBe(true);
    if (v.ok) { expect(v.lead.name).toBe('Ann'); expect(v.lead.listingId).toBe('123'); }
  });
  it('rejects honeypot, bad phone, bad email, short message, link spam', () => {
    expect(validateLead({ ...good, website: 'x' })).toMatchObject({ ok: false });
    expect(validateLead({ ...good, phone: '12' })).toMatchObject({ ok: false, error: expect.stringMatching(/phone/) });
    expect(validateLead({ ...good, email: 'nope' })).toMatchObject({ ok: false, error: expect.stringMatching(/email/) });
    expect(validateLead({ ...good, message: 'hi' })).toMatchObject({ ok: false });
    expect(validateLead({ ...good, message: 'http://a.b http://c.d http://e.f buy' })).toMatchObject({ ok: false, error: expect.stringMatching(/links/) });
    expect(validateLead(null)).toMatchObject({ ok: false });
  });
});

describe('leadCaption', () => {
  it('escapes HTML and links both site and KSL', () => {
    const c = leadCaption(env, { name: 'A <b>', phone: '1', email: '', message: 'm & m', listingId: '1', page: '', sid: '' }, { id: '1', title: '2020 Car', price: 1234, photo: null, url: 'https://cars.ksl.com/listing/1', path: '/cars/x-1/', status: 'active' }, 'Provo, UT, US');
    expect(c).toContain('New lead: 2020 Car</b> — $1,234');
    expect(c).toContain('A &lt;b&gt;');
    expect(c).toContain('m &amp; m');
    expect(c).toContain('https://user.github.io/drift/cars/x-1/');
    expect(c).toContain('https://cars.ksl.com/listing/1');
    expect(c).toContain('Provo, UT, US');
  });
});

describe('auth and utils', () => {
  const req = (token?: string) => new Request('https://w/admin/stats', { headers: token ? { authorization: `Bearer ${token}` } : {} });
  it('authorize distinguishes roles', () => {
    expect(authorize(req('admin-secret'), env)).toBe('admin');
    expect(authorize(req('dash-secret'), env)).toBe('dashboard');
    expect(authorize(req('nope'), env)).toBeNull();
    expect(authorize(req(), env)).toBeNull();
    expect(authorize(req(''), { ...env, ADMIN_TOKEN: '' })).toBeNull();
  });
  it('safeEqual / sha256 / device / referrer / origin', async () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('', '')).toBe(false);
    expect(await sha256Hex('x')).toHaveLength(64);
    expect(device('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile')).toBe('mobile');
    expect(device('Mozilla/5.0 (iPad; CPU OS 17_0)')).toBe('tablet');
    expect(device('Googlebot/2.1')).toBe('bot');
    expect(device('Mozilla/5.0 (Macintosh)')).toBe('desktop');
    expect(referrerHost('https://www.google.com/search?q=x', 'https://user.github.io')).toBe('google.com');
    expect(referrerHost('https://user.github.io/drift/inventory/', 'https://user.github.io')).toBe('');
    expect(referrerHost('garbage', '')).toBe('');
    expect(allowedOrigin(env, 'https://user.github.io')).toBe(true);
    expect(allowedOrigin(env, 'https://evil.com')).toBe(false);
    expect(allowedOrigin(env, 'http://localhost:4321')).toBe(true);
  });
});
