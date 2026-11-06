// cars.ksl.com is a Next.js app. The server embeds the page data as React Flight (RSC)
// rows inside `self.__next_f.push([1,"..."])` scripts. These helpers turn an HTML page
// back into the plain JSON objects we care about. Pure functions; unit-tested with fixtures.

/** Concatenates every __next_f chunk into one payload string. */
export function extractFlightPayload(html: string): string {
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let out = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out += JSON.parse(m[1]!) as string;
  return out;
}

/** Returns the end index (exclusive) of the balanced JSON value starting at `start`. */
export function balancedEnd(s: string, start: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error('Unbalanced JSON in flight payload');
}

/** Parses the JSON value that starts at the first occurrence of `marker` + value. */
export function jsonAfter<T = unknown>(payload: string, marker: string, from = 0): { value: T; end: number } | null {
  const i = payload.indexOf(marker, from);
  if (i < 0) return null;
  const start = i + marker.length;
  const end = balancedEnd(payload, start);
  return { value: JSON.parse(payload.slice(start, end)) as T, end };
}

/**
 * Resolves a Flight reference like "$4b" to its text. Long strings are stored as
 * `<id>:T<hexByteLength>,<text>` rows (no trailing newline); short ones as `<id>:"json"`.
 */
export function resolveRef(payload: string, ref: string): string | null {
  if (!ref.startsWith('$')) return ref;
  const id = ref.slice(1);
  const re = new RegExp(`(?:^|\\n)${id}:`);
  const m = re.exec(payload);
  if (!m) return null;
  const at = m.index + m[0].length;
  if (payload[at] === 'T') {
    const comma = payload.indexOf(',', at);
    const byteLen = parseInt(payload.slice(at + 1, comma), 16);
    const rest = Buffer.from(payload.slice(comma + 1), 'utf8');
    return rest.subarray(0, byteLen).toString('utf8');
  }
  if (payload[at] === '"') {
    const end = balancedStringEnd(payload, at);
    return JSON.parse(payload.slice(at, end)) as string;
  }
  return null;
}

function balancedStringEnd(s: string, start: number): number {
  let esc = false;
  for (let i = start + 1; i < s.length; i++) {
    const c = s[i];
    if (esc) esc = false;
    else if (c === '\\') esc = true;
    else if (c === '"') return i + 1;
  }
  throw new Error('Unterminated string in flight payload');
}

export interface KslSearchPage {
  items: Record<string, unknown>[];
  total: number;
  /** null when the page carried no pageInfo block (fall back to counting). */
  hasNextPage: boolean | null;
}

export function parseSearchPage(html: string): KslSearchPage {
  const payload = extractFlightPayload(html);
  const results = jsonAfter<unknown[]>(payload, '"initialState":{"results":');
  if (!results) throw new Error('KSL search page: results block not found (page layout changed?)');
  const items = (results.value as unknown[]).flat() as Record<string, unknown>[];
  const pageInfo = jsonAfter<{ hasNextPage?: boolean; total?: number }[]>(payload, '"pageInfo":', results.end);
  const info = pageInfo?.value?.[0];
  return { items, total: info?.total ?? items.length, hasNextPage: info ? Boolean(info.hasNextPage) : null };
}

export function parseDetailPage(html: string): Record<string, unknown> {
  const payload = extractFlightPayload(html);
  const at = payload.indexOf('"listing":{"id":');
  if (at < 0) throw new Error('KSL detail page: listing block not found (removed listing or layout changed?)');
  const braceStart = at + '"listing":'.length;
  const obj = JSON.parse(payload.slice(braceStart, balancedEnd(payload, braceStart))) as Record<string, unknown>;
  if (typeof obj.description === 'string' && obj.description.startsWith('$')) {
    obj.description = resolveRef(payload, obj.description) ?? '';
  }
  return obj;
}
