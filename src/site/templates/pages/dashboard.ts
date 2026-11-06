import { SiteContext } from '../../context.js';
import { html } from '../html.js';
import { layout } from '../layout.js';

/** Token-gated analytics dashboard. Data comes live from the worker; this page is just the shell. */
export function dashboardPage(ctx: SiteContext): { path: string; html: string } {
  const body = html`<section class="container section dash"><div id="dash"><p class="muted">Loading…</p></div></section><script src="/assets/dash.js?v=${ctx.version}" defer></script>`;
  return { path: '/dash/', html: layout(ctx, { title: 'Dashboard', description: 'Private dashboard', path: '/dash/', noindex: true, bodyClass: 'dash-body' }, body) };
}
