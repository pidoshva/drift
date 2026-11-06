// Tiny HTML templating: a tagged template that escapes every interpolation unless it is
// wrapped in raw(). Arrays are joined. No framework, nothing to learn.
export class RawHtml { constructor(public readonly value: string) {} toString(): string { return this.value; } }
export const raw = (s: string): RawHtml => new RawHtml(s);

export function escapeHtml(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

type Child = string | number | boolean | null | undefined | RawHtml | Child[];

function render(child: Child): string {
  if (child === null || child === undefined || child === false || child === true) return '';
  if (child instanceof RawHtml) return child.value;
  if (Array.isArray(child)) return child.map(render).join('');
  return escapeHtml(child);
}

export function html(strings: TemplateStringsArray, ...values: Child[]): RawHtml {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < values.length) out += render(values[i]); });
  return new RawHtml(out);
}

export const attr = (name: string, value: string | number | null | undefined): RawHtml =>
  value === null || value === undefined || value === '' ? raw('') : raw(` ${name}="${escapeHtml(value)}"`);
