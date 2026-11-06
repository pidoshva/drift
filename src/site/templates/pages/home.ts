import { SiteContext } from '../../context.js';
import { carCard, emptyState } from '../components.js';
import { html, raw } from '../html.js';
import { PageMeta, layout } from '../layout.js';

export function homePage(ctx: SiteContext): { path: string; html: string } {
  const { config, theme } = ctx;
  const featured = ctx.active.slice(0, config.site.featuredCount);
  const meta: PageMeta = {
    title: config.site.title || config.dealer.name,
    description: config.dealer.tagline || `${config.dealer.name} — ${ctx.active.length} vehicles in stock${config.dealer.city ? ` in ${config.dealer.city}` : ''}.`,
    path: '/',
    image: featured[0]?.photos[0],
  };
  const body = html`
<section class="hero${theme.hero.imageUrl ? ' hero--photo' : ''}" ${theme.hero.imageUrl ? raw(`style="--hero-image:url('${theme.hero.imageUrl}')"`) : ''}>
  <div class="container hero__inner">
    <h1 class="hero__headline">${theme.hero.headline || config.dealer.name}</h1>
    <p class="hero__sub">${theme.hero.subheadline || config.dealer.tagline}</p>
    <div class="hero__actions">
      <a class="button button--primary button--lg" href="/inventory/">${theme.hero.ctaLabel} (${ctx.active.length})</a>
      <a class="button button--ghost button--lg" href="/contact/">${theme.labels.contact}</a>
    </div>
  </div>
</section>
${theme.highlights.length ? html`<section class="container highlights">${theme.highlights.map((h) => html`<div class="highlight"><h3>${h.title}</h3><p>${h.text}</p></div>`)}</section>` : ''}
<section class="container section">
  <div class="section__head"><h2>Latest arrivals</h2><a href="/inventory/">See all ${ctx.active.length} →</a></div>
  ${featured.length ? html`<div class="car-grid">${featured.map((l) => carCard(ctx, l))}</div>` : emptyState('New inventory is on the way. Check back soon or give us a call.')}
</section>
${config.dealer.about ? html`<section class="container section about"><h2>About ${config.dealer.name}</h2><p>${config.dealer.about}</p></section>` : ''}`;
  return { path: '/', html: layout(ctx, meta, body) };
}
