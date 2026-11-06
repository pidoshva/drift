import { SiteContext } from '../../context.js';
import { carCard, emptyState } from '../components.js';
import { html } from '../html.js';
import { layout } from '../layout.js';

export function inventoryPage(ctx: SiteContext): { path: string; html: string } {
  const makes = [...new Set(ctx.active.map((l) => l.make).filter(Boolean))].sort();
  const bodies = [...new Set(ctx.active.map((l) => l.body).filter(Boolean))].sort();
  const body = html`
<section class="container section">
  <div class="section__head"><h1>${ctx.theme.labels.inventory} <span class="muted" data-inventory-count>(${ctx.active.length})</span></h1></div>
  <form class="filters" data-filters aria-label="Filter inventory">
    <input type="search" name="q" placeholder="Search make, model, color, VIN…" aria-label="Search">
    <select name="make" aria-label="Make"><option value="">All makes</option>${makes.map((m) => html`<option value="${m}">${m}</option>`)}</select>
    <select name="body" aria-label="Body style"><option value="">All body styles</option>${bodies.map((b) => html`<option value="${b}">${b}</option>`)}</select>
    <select name="sort" aria-label="Sort">
      <option value="newest">Newest first</option>
      <option value="price-asc">Price: low to high</option>
      <option value="price-desc">Price: high to low</option>
      <option value="mileage-asc">Mileage: low to high</option>
      <option value="year-desc">Year: newest</option>
    </select>
  </form>
  ${ctx.active.length ? html`<div class="car-grid" data-inventory-grid>${ctx.active.map((l) => carCard(ctx, l))}</div><div class="empty-state" data-inventory-empty hidden><p>No cars match those filters.</p></div>` : emptyState('No vehicles listed right now. Call us — new cars arrive every week.')}
</section>`;
  return { path: '/inventory/', html: layout(ctx, { title: ctx.theme.labels.inventory, description: `Browse ${ctx.active.length} vehicles for sale at ${ctx.config.dealer.name}.`, path: '/inventory/' }, body) };
}
