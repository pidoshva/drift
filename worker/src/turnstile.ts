// Cloudflare Turnstile verification (free bot protection). Skipped when no secret is set.
import { Env } from './types.js';

export async function verifyTurnstile(env: Env, token: string, ip: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;
  const res = await fetch(`${(env.TURNSTILE_API_BASE ?? 'https://challenges.cloudflare.com').replace(/\/+$/, '')}/turnstile/v0/siteverify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }),
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { success?: boolean };
  return Boolean(data.success);
}
