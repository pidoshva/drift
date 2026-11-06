// Small terminal output helpers shared by commands (tables, status lines, JSON mode).
const tty = process.stdout.isTTY && !process.env.CI;
const c = (code: string, s: string): string => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = (s: string): string => c('1', s);
export const dim = (s: string): string => c('2', s);
export const green = (s: string): string => c('32', s);
export const yellow = (s: string): string => c('33', s);
export const red = (s: string): string => c('31', s);
export const cyan = (s: string): string => c('36', s);

export const ok = (msg: string): void => console.log(`${green('✔')} ${msg}`);
export const warn = (msg: string): void => console.log(`${yellow('!')} ${msg}`);
export const fail = (msg: string): void => console.log(`${red('✖')} ${msg}`);
export const info = (msg: string): void => console.log(`${cyan('›')} ${msg}`);
export const heading = (msg: string): void => console.log(`\n${bold(msg)}`);

export function table(rows: object[], columns?: string[]): void {
  if (!rows.length) { console.log(dim('  (none)')); return; }
  const cols = columns ?? Object.keys(rows[0]!);
  const get = (r: object, k: string): unknown => (r as Record<string, unknown>)[k];
  const cell = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const widths = cols.map((col) => Math.min(60, Math.max(col.length, ...rows.map((r) => cell(get(r, col)).length))));
  const line = (vals: string[]) => '  ' + vals.map((v, i) => v.slice(0, widths[i]).padEnd(widths[i]!)).join('  ');
  console.log(dim(line(cols)));
  for (const r of rows) console.log(line(cols.map((col) => cell(get(r, col)))));
}

export function printJson(data: unknown): void { console.log(JSON.stringify(data, null, 2)); }

export function die(msg: string, code = 1): never {
  fail(msg);
  process.exit(code);
}
