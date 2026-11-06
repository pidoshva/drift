// Cloudflare Worker: the only server-side piece of drift.
//   POST /contact      lead from the website → Telegram / email (+ stored in D1)
//   POST /e            analytics event from the website (stored in D1)
//   GET  /health       config check (no auth)
//   /admin/*           stats & records for the CLI/dashboard (Bearer token)
import { authorize, handleAdmin } from './admin.js';
import { handleEvent } from './analytics.js';
import { handleContact } from './contact.js';
import { Env, VERSION } from './types.js';
import { corsHeaders, json } from './util.js';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(env, request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname === '/health') {
        let db = false;
        try { await env.DB.prepare('SELECT 1').first(); db = true; } catch { db = false; }
        return json({ ok: true, version: VERSION, telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID), email: Boolean(env.RESEND_API_KEY && env.CONTACT_EMAIL), turnstile: Boolean(env.TURNSTILE_SECRET_KEY), db, site: env.SITE_URL, methods: env.CONTACT_METHODS }, 200, cors);
      }
      if (url.pathname === '/contact' && request.method === 'POST') return await handleContact(request, env, cors);
      if (url.pathname === '/e' && request.method === 'POST') return await handleEvent(request, env, cors);
      if (url.pathname.startsWith('/admin/')) {
        const role = authorize(request, env);
        if (!role) return json({ error: 'unauthorized' }, 401, cors);
        const res = await handleAdmin(request, url, env, role);
        for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
        return res;
      }
      return json({ error: 'not found' }, 404, cors);
    } catch (err) {
      console.error('unhandled', (err as Error).stack ?? err);
      return json({ ok: false, error: 'Internal error' }, 500, cors);
    }
  },
} satisfies ExportedHandler<Env>;
