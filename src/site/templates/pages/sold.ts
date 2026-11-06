import { SiteContext } from '../../context.js';
import { carCard, emptyState } from '../components.js';
import { html } from '../html.js';
import { layout } from '../layout.js';

export function soldPage(ctx: SiteContext): { path: string; html: string } {
  const body = html`
<section class="container section">
  <div class="section__head"><h1>${ctx.theme.labels.sold}</h1><p class="muted">Cars that found a home in the last ${ctx.config.site.soldDays} days.</p></div>
  ${ctx.sold.length ? html`<div class="car-grid">${ctx.sold.map((l) => carCard(ctx, l, { sold: true }))}</div>` : emptyState('Nothing sold recently — be the first!')}
</section>`;
  return { path: '/sold/', html: layout(ctx, { title: ctx.theme.labels.sold, description: `Recently sold vehicles at ${ctx.config.dealer.name}.`, path: '/sold/' }, body) };
}
