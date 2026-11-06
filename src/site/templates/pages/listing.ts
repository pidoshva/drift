import { Listing, formatPrice, listingPath } from '../../../core/listing.js';
import { SiteContext } from '../../context.js';
import { carCard, contactForm, gallery, priceDrop, specTable } from '../components.js';
import { html, raw } from '../html.js';
import { layout } from '../layout.js';

export function listingPage(ctx: SiteContext, l: Listing): { path: string; html: string } {
  const { config, theme } = ctx;
  const path = listingPath(l);
  const phone = config.site.showPhone ? (config.contact.phone || config.dealer.phoneDisplay) : '';
  const similar = ctx.active.filter((o) => o.id !== l.id && (o.make === l.make || o.body === l.body)).slice(0, 4);
  const drop = priceDrop(l);
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'Car', name: l.title, vehicleIdentificationNumber: l.vin || undefined,
    brand: l.make, model: l.model, vehicleModelDate: l.year ?? undefined, mileageFromOdometer: l.mileage ?? undefined,
    color: l.exteriorColor || undefined, image: l.photos.slice(0, 5), url: ctx.siteUrl + path,
    offers: l.price ? { '@type': 'Offer', price: l.price, priceCurrency: 'USD', availability: 'https://schema.org/InStock', seller: { '@type': 'AutoDealer', name: config.dealer.name } } : undefined,
  };
  const body = html`
<article class="container section listing">
  <nav class="breadcrumb"><a href="/">Home</a> › <a href="/inventory/">${theme.labels.inventory}</a> › <span>${l.title}</span></nav>
  <div class="listing__grid">
    <div class="listing__media">${gallery(l)}</div>
    <aside class="listing__panel">
      <h1 class="listing__title">${l.title}</h1>
      <div class="listing__price">${formatPrice(l.price)}${drop ? html` <s class="muted">${formatPrice(drop)}</s>` : ''}</div>
      ${l.msrp && l.price && l.msrp > l.price ? html`<div class="muted small">MSRP ${formatPrice(l.msrp)}</div>` : ''}
      <div class="listing__actions">
        ${phone ? html`<a class="button button--primary" href="tel:${phone}" data-track="call">${theme.labels.callNow}</a>` : ''}
        <a class="button button--ghost" href="#contact">${theme.labels.askAbout}</a>
        ${l.url ? html`<a class="button button--ghost" href="${l.url}" target="_blank" rel="noopener" data-track="ksl">${theme.labels.viewOnKsl}</a>` : ''}
        ${l.carfaxUrl ? html`<a class="button button--ghost" href="${l.carfaxUrl}" target="_blank" rel="noopener" data-track="carfax">Carfax report</a>` : ''}
      </div>
      ${specTable(l)}
    </aside>
  </div>
  ${l.description ? html`<section class="listing__section"><h2>Description</h2><div class="prose">${l.description.split(/\n{2,}|\r?\n/).filter(Boolean).map((p) => html`<p>${p}</p>`)}</div></section>` : ''}
  ${l.options.length ? html`<section class="listing__section"><h2>Features & options</h2><ul class="options-list">${l.options.map((o) => html`<li>${o}</li>`)}</ul></section>` : ''}
  <section class="listing__section" id="contact"><h2>${theme.labels.askAbout}</h2>${contactForm(ctx, l)}</section>
  ${similar.length ? html`<section class="listing__section"><h2>You may also like</h2><div class="car-grid">${similar.map((s) => carCard(ctx, s))}</div></section>` : ''}
</article>
<script type="application/ld+json">${raw(JSON.stringify(jsonLd).replace(/</g, '\\u003c'))}</script>`;
  const description = `${l.title} for ${formatPrice(l.price)} at ${config.dealer.name}.${l.mileage !== null ? ` ${l.mileage.toLocaleString('en-US')} miles.` : ''}`;
  return { path, html: layout(ctx, { title: l.title, description, path, image: l.photos[0], listingId: l.id }, body) };
}
