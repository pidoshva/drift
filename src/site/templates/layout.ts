// The page shell: <head>, header, footer, and the data attributes the client JS reads.
// Change navigation/branding in theme.json and drift.config.json; change looks in theme/*.css.
import { SiteContext } from '../context.js';
import { RawHtml, html, raw } from './html.js';

export interface PageMeta {
  title: string;
  description: string;
  path: string;        // e.g. "/inventory/"
  image?: string;
  listingId?: string;  // set on car pages so analytics can attribute views
  noindex?: boolean;
  bodyClass?: string;
}

export function layout(ctx: SiteContext, meta: PageMeta, body: RawHtml): string {
  const { config, theme } = ctx;
  const fullTitle = meta.path === '/' ? (config.site.title || config.dealer.name) : `${meta.title} · ${config.dealer.name}`;
  const canonical = ctx.siteUrl + meta.path;
  const phone = config.site.showPhone ? (config.dealer.phoneDisplay || config.contact.phone) : '';
  const nav = theme.nav.length ? theme.nav : [
    { label: theme.labels.inventory, href: '/inventory/' },
    ...(config.site.showSold ? [{ label: theme.labels.sold, href: '/sold/' }] : []),
    { label: theme.labels.contact, href: '/contact/' },
  ];
  return '<!DOCTYPE html>\n' + html`<html lang="en" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${meta.description}">
<link rel="canonical" href="${canonical}">
${meta.noindex ? raw('<meta name="robots" content="noindex">') : ''}
<meta property="og:title" content="${fullTitle}">
<meta property="og:description" content="${meta.description}">
<meta property="og:url" content="${canonical}">
<meta property="og:type" content="website">
${meta.image ? html`<meta property="og:image" content="${meta.image}">` : ''}
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/site.css?v=${ctx.version}">
${config.contact.turnstileSiteKey ? raw('<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>') : ''}
</head>
<body class="${meta.bodyClass ?? ''}" data-worker-url="${ctx.workerUrl}" data-base="${ctx.basePath}" data-analytics="${config.analytics.enabled ? '1' : '0'}"${meta.listingId ? raw(` data-listing-id="${meta.listingId}"`) : ''} data-turnstile-key="${config.contact.turnstileSiteKey}">
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <div class="container site-header__inner">
    <a class="brand" href="/"><img class="brand__logo" src="/assets/logo.svg" alt="" width="36" height="36"><span class="brand__name">${config.dealer.name}</span></a>
    <button class="nav-toggle" aria-label="Menu" aria-expanded="false" data-nav-toggle>☰</button>
    <nav class="site-nav" data-nav>
      ${nav.map((n) => html`<a class="site-nav__link${n.href === meta.path ? ' is-active' : ''}" href="${n.href}">${n.label}</a>`)}
      ${phone ? html`<a class="button button--primary site-nav__call" href="tel:${config.contact.phone || phone}" data-track="call">${theme.labels.callNow}${raw(' · ')}${phone}</a>` : ''}
    </nav>
  </div>
</header>
<main id="main">${body}</main>
<footer class="site-footer">
  <div class="container site-footer__inner">
    <div>
      <strong>${config.dealer.name}</strong>
      ${config.dealer.address ? html`<div>${config.dealer.address}${config.dealer.city ? `, ${config.dealer.city}` : ''}</div>` : ''}
      ${config.dealer.hours.map((h) => html`<div class="muted">${h}</div>`)}
    </div>
    <div class="site-footer__links">
      ${phone ? html`<a href="tel:${config.contact.phone || phone}" data-track="call">${phone}</a>` : ''}
      ${config.dealer.kslProfileUrl ? html`<a href="${config.dealer.kslProfileUrl}" rel="noopener" target="_blank" data-track="ksl">Our KSL listings</a>` : ''}
      ${config.dealer.facebookUrl ? html`<a href="${config.dealer.facebookUrl}" rel="noopener" target="_blank">Facebook</a>` : ''}
      <a href="/contact/">${theme.labels.contact}</a>
    </div>
    <div class="muted small">${theme.labels.footerNote} Inventory updated ${ctx.builtAt.slice(0, 16).replace('T', ' ')} UTC.</div>
  </div>
</footer>
<script src="/assets/site.js?v=${ctx.version}" defer></script>
</body>
</html>`.value;
}
