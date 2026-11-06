import { SiteContext } from '../../context.js';
import { contactForm } from '../components.js';
import { html } from '../html.js';
import { layout } from '../layout.js';

export function contactPage(ctx: SiteContext): { path: string; html: string } {
  const { config, theme } = ctx;
  const phone = config.site.showPhone ? (config.dealer.phoneDisplay || config.contact.phone) : '';
  const body = html`
<section class="container section contact">
  <div class="contact__grid">
    <div>
      <h1>${theme.labels.contact}</h1>
      ${phone ? html`<p class="contact__big"><a href="tel:${config.contact.phone || phone}" data-track="call">${phone}</a></p>` : ''}
      ${config.dealer.address ? html`<p>${config.dealer.address}${config.dealer.city ? html`<br>${config.dealer.city}` : ''}</p>` : ''}
      ${config.dealer.hours.length ? html`<h3>Hours</h3><ul class="plain">${config.dealer.hours.map((h) => html`<li>${h}</li>`)}</ul>` : ''}
      ${config.dealer.kslProfileUrl ? html`<p><a href="${config.dealer.kslProfileUrl}" target="_blank" rel="noopener" data-track="ksl">See our listings on KSL →</a></p>` : ''}
    </div>
    <div><h2>Send a message</h2>${contactForm(ctx)}</div>
  </div>
</section>`;
  return { path: '/contact/', html: layout(ctx, { title: theme.labels.contact, description: `Call or message ${config.dealer.name}.`, path: '/contact/' }, body) };
}
