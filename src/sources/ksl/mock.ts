// Mock KSL: a fake `fetch` that renders flight-style pages from a seed file, so the whole
// sync pipeline (parser → mapper → merge → site) runs offline and in CI with no KSL traffic.
// Enable with `drift sync --mock` or DRIFT_MOCK_KSL=1.
//   DRIFT_MOCK_SOLD="id,id"    -> those listings disappear from search and report status Sold
//   DRIFT_MOCK_PRICE="id:price" -> override a price (simulates a price drop)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS } from '../../core/paths.js';

export const MOCK_SEED = join(PATHS.root, 'tests', 'fixtures', 'mock-ksl-listings.json');

export interface MockOptions {
  seedFile?: string;
  sold?: string[];
  prices?: Record<string, number>;
  perPage?: number;
}

export function mockFromEnv(): MockOptions {
  const sold = (process.env.DRIFT_MOCK_SOLD ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const prices: Record<string, number> = {};
  for (const pair of (process.env.DRIFT_MOCK_PRICE ?? '').split(',')) {
    const [id, p] = pair.split(':');
    if (id && p) prices[id.trim()] = Number(p);
  }
  return { sold, prices };
}

function flightPage(rows: string): string {
  const chunk = JSON.stringify(rows);
  return `<!DOCTYPE html><html><head><title>mock ksl</title></head><body><script>(self.__next_f=self.__next_f||[]).push([0])</script><script>self.__next_f.push([1,${chunk}])</script></body></html>`;
}

export function createMockKslFetch(opts: MockOptions = {}): typeof fetch {
  const seed = JSON.parse(readFileSync(opts.seedFile ?? MOCK_SEED, 'utf8')) as Record<string, unknown>[];
  const sold = new Set(opts.sold ?? []);
  const perPage = opts.perPage ?? 20;
  const listings: Record<string, unknown>[] = seed.map((raw) => ({ ...raw, price: opts.prices?.[String(raw.id)] ?? raw.price }));
  const active = listings.filter((l) => !sold.has(String(l.id)));

  return async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const search = /^\/search\/memberId\/([^/]+)(?:\/page\/(\d+))?$/.exec(url.pathname);
    if (search) {
      const page = Number(search[2] ?? '1');
      const items = active.slice((page - 1) * perPage, page * perPage).map(({ description: _d, photos: _p, options: _o, ...row }) => row);
      const rows = `4a:["$","$L4c",null,{"initialState":{"results":${JSON.stringify([items])},"pageInfo":[{"hasNextPage":${page * perPage < active.length},"endCursor":"x","total":${active.length}}]},"children":"$L4d"}]\n`;
      return new Response(flightPage(rows), { status: 200, headers: { 'content-type': 'text/html' } });
    }
    const detail = /^\/listing\/(\d+)$/.exec(url.pathname);
    if (detail) {
      const l = listings.find((x) => String(x.id) === detail[1]);
      if (!l) return new Response('not found', { status: 404 });
      const desc = String(l.description ?? '');
      const byteLen = Buffer.byteLength(desc, 'utf8').toString(16);
      const obj = { ...l, status: sold.has(String(l.id)) ? 'Sold' : 'Active', listingStatus: sold.has(String(l.id)) ? 'Sold' : 'Active', description: '$4b' };
      const rows = `4b:T${byteLen},${desc}c:[["$","$L47",null,{"phones":null}],["$","$L4a",null,{"listing":${JSON.stringify(obj)}}]]\n`;
      return new Response(flightPage(rows), { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response('mock: unknown route ' + url.pathname, { status: 404 });
  };
}
