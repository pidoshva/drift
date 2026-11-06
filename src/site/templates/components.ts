// Reusable pieces shared by pages. Keep them small and data-driven.
import { Listing, formatMileage, formatPrice, listingPath } from '../../core/listing.js';
import { SiteContext } from '../context.js';
import { RawHtml, html, raw } from './html.js';

export const PLACEHOLDER = '/assets/placeholder.svg';
export const photo = (l: Listing, i = 0): string => l.photos[i] ?? PLACEHOLDER;

const FIELD_LABEL: Record<string, (l: Listing) => string> = {
  mileage: (l) => formatMileage(l.mileage),
  transmission: (l) => l.transmission,
  drive: (l) => l.drive,
  fuel: (l) => l.fuel,
  body: (l) => l.body,
  exteriorColor: (l) => l.exteriorColor,
};

export function carCard(ctx: SiteContext, l: Listing, opts: { sold?: boolean } = {}): RawHtml {
  const facts = ctx.theme.cardFields.map((f) => FIELD_LABEL[f]?.(l)).filter(Boolean);
  const drop = priceDrop(l);
  return html`<article class="car-card${opts.sold ? ' car-card--sold' : ''}" data-listing-id="${l.id}" data-make="${l.make}" data-body="${l.body}" data-price="${l.price ?? ''}" data-year="${l.year ?? ''}" data-mileage="${l.mileage ?? ''}" data-condition="${l.condition}" data-text="${[l.title, l.exteriorColor, l.vin, l.stockNumber].join(' ').toLowerCase()}">
  <a class="car-card__media" href="${opts.sold ? '#' : listingPath(l)}" ${opts.sold ? raw('tabindex="-1" aria-hidden="true"') : ''}>
    <img src="${photo(l)}" alt="${l.title}" loading="lazy" width="400" height="300">
    ${opts.sold ? html`<span class="badge badge--sold">Sold</span>` : l.condition === 'New' ? html`<span class="badge">New</span>` : drop ? html`<span class="badge badge--drop">Price drop</span>` : ''}
  </a>
  <div class="car-card__body">
    <h3 class="car-card__title"><a href="${opts.sold ? '#' : listingPath(l)}">${l.title}</a></h3>
    <div class="car-card__price">${formatPrice(l.price)}${drop ? html` <s class="muted small">${formatPrice(drop)}</s>` : ''}</div>
    <ul class="car-card__facts">${facts.map((f) => html`<li>${f}</li>`)}</ul>
  </div>
</article>`;
}

/** Previous price when the latest change was a reduction. */
export function priceDrop(l: Listing): number | null {
  const h = l.priceHistory;
  if (h.length < 2) return null;
  const prev = h[h.length - 2]!.price;
  const cur = h[h.length - 1]!.price;
  return prev !== null && cur !== null && cur < prev ? prev : null;
}

export function specTable(l: Listing): RawHtml {
  const rows: [string, string][] = [
    ['Year', String(l.year ?? '')], ['Make', l.make], ['Model', l.model], ['Trim', l.trim], ['Condition', l.condition],
    ['Mileage', l.mileage === null ? '' : formatMileage(l.mileage)], ['Body', l.body], ['Transmission', l.transmission],
    ['Drivetrain', l.drive], ['Fuel', l.fuel], ['Engine', [l.liters, l.cylinders && `${l.cylinders} cyl`].filter(Boolean).join(' · ')],
    ['Exterior', l.exteriorColor], ['Interior', l.interiorColor], ['Doors', l.doors ? String(l.doors) : ''], ['Seats', l.seats ? String(l.seats) : ''],
    ['Title', l.titleType], ['VIN', l.vin], ['Stock #', l.stockNumber],
  ];
  return html`<dl class="spec-table">${rows.filter(([, v]) => v).map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;
}

export function contactForm(ctx: SiteContext, l?: Listing): RawHtml {
  const key = ctx.config.contact.turnstileSiteKey;
  return html`<form class="contact-form" data-contact-form novalidate>
  ${l ? html`<input type="hidden" name="listingId" value="${l.id}"><p class="contact-form__about">About: <strong>${l.title}</strong> · ${formatPrice(l.price)}</p>` : ''}
  <label>Your name <input name="name" required maxlength="100" autocomplete="name"></label>
  <label>Phone <input name="phone" type="tel" required maxlength="40" autocomplete="tel" placeholder="801-555-0100"></label>
  <label>Email <span class="muted">(optional)</span> <input name="email" type="email" maxlength="120" autocomplete="email"></label>
  <label>Message <textarea name="message" rows="4" maxlength="2000" required placeholder="${l ? 'Is this still available? Can I come see it this week?' : 'How can we help?'}"></textarea></label>
  <input type="text" name="website" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true">
  ${key ? html`<div class="cf-turnstile" data-sitekey="${key}"></div>` : ''}
  <button class="button button--primary" type="submit">Send message</button>
  <p class="contact-form__status" role="status" aria-live="polite"></p>
</form>`;
}

export function gallery(l: Listing): RawHtml {
  const photos = l.photos.length ? l.photos : [PLACEHOLDER];
  return html`<div class="gallery" data-gallery>
  <div class="gallery__main"><img src="${photos[0]}" alt="${l.title}" data-gallery-main width="1200" height="900"></div>
  ${photos.length > 1 ? html`<div class="gallery__thumbs">${photos.map((p, i) => html`<button type="button" class="gallery__thumb${i === 0 ? ' is-active' : ''}" data-gallery-thumb="${p}"><img src="${p}" alt="Photo ${i + 1} of ${l.title}" loading="lazy" width="160" height="120"></button>`)}</div>` : ''}
</div>`;
}

export function emptyState(text: string): RawHtml {
  return html`<div class="empty-state"><p>${text}</p></div>`;
}
