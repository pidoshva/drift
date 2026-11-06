// Email relay through Resend (free tier: 3,000 emails/month). Optional.
import { Env, LeadInput, PublicListing } from './types.js';
import { escHtml } from './util.js';

export async function sendLeadEmail(env: Env, lead: LeadInput, listing: PublicListing | undefined, where: string): Promise<void> {
  if (!env.RESEND_API_KEY || !env.CONTACT_EMAIL) throw new Error('email not configured');
  const site = env.SITE_URL.replace(/\/+$/, '');
  const subject = listing ? `Lead: ${listing.title} — ${lead.name}` : `Website message from ${lead.name}`;
  const html = `
<div style="font-family:system-ui,sans-serif;max-width:560px">
  <h2 style="margin:0 0 8px">${escHtml(subject)}</h2>
  ${listing?.photo ? `<img src="${escHtml(listing.photo)}" alt="" style="max-width:100%;border-radius:8px">` : ''}
  <p><b>Name:</b> ${escHtml(lead.name)}<br><b>Phone:</b> <a href="tel:${escHtml(lead.phone)}">${escHtml(lead.phone)}</a>${lead.email ? `<br><b>Email:</b> <a href="mailto:${escHtml(lead.email)}">${escHtml(lead.email)}</a>` : ''}</p>
  <p style="white-space:pre-wrap;background:#f4f4f2;padding:12px;border-radius:8px">${escHtml(lead.message)}</p>
  ${listing ? `<p><a href="${site}${listing.path}">View on the website</a>${listing.url ? ` · <a href="${escHtml(listing.url)}">View on KSL</a>` : ''}</p>` : ''}
  ${where ? `<p style="color:#777">Sent from ${escHtml(where)}</p>` : ''}
</div>`;
  const res = await fetch(`${(env.RESEND_API_BASE ?? 'https://api.resend.com').replace(/\/+$/, '')}/emails`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.RESEND_API_KEY}` },
    body: JSON.stringify({ from: `${env.DEALER_NAME || 'Website'} <${env.CONTACT_FROM_EMAIL}>`, to: [env.CONTACT_EMAIL], reply_to: lead.email || undefined, subject, html }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
