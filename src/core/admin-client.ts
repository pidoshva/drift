// Typed client for the worker's admin API (used by `drift stats`, `drift leads`, `drift logs --remote`,
// `drift digest`, `drift contact test`). The response shapes are defined once in worker/src/types.ts
// and mirrored here so the CLI has no dependency on worker code.
import { Config } from './config.js';
import { requireSecret } from './env.js';

export interface StatsResponse {
  days: number;
  from: string;
  to: string;
  totals: { pageviews: number; visitors: number; listingViews: number; leads: number; callClicks: number; kslClicks: number };
  daily: { day: string; pageviews: number; visitors: number; listingViews: number; leads: number }[];
  topListings: { listingId: string; title: string; views: number; leads: number }[];
  topReferrers: { referrer: string; count: number }[];
  topPaths: { path: string; count: number }[];
  countries: { country: string; count: number }[];
  cities: { city: string; region: string; country: string; count: number }[];
  devices: { device: string; count: number }[];
  recentLeads: Lead[];
  jobs: JobEvent[];
}
export interface Lead { id: number; ts: string; name: string; phone: string; email: string; message: string; listingId: string; listingTitle: string; country: string; city: string; delivered: string; }
export interface JobEvent { id: number; ts: string; type: string; status: string; summary: Record<string, unknown>; }
export interface EventRow { id: number; ts: string; type: string; path: string; listingId: string; referrer: string; country: string; region: string; city: string; ip: string; device: string; }

export class AdminClient {
  constructor(private readonly baseUrl: string, private readonly token: string) {}

  static fromConfig(config: Config): AdminClient {
    const url = config.worker.url.replace(/\/+$/, '');
    if (!url) throw new Error('worker.url is not set (drift config set worker.url https://<name>.<account>.workers.dev)');
    return new AdminClient(url, requireSecret('DRIFT_ADMIN_TOKEN', 'admin API auth'));
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Worker ${method} ${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }

  stats(days: number): Promise<StatsResponse> { return this.call('GET', `/admin/stats?days=${days}`); }
  leads(limit: number): Promise<{ leads: Lead[] }> { return this.call('GET', `/admin/leads?limit=${limit}`); }
  events(limit: number, type?: string): Promise<{ events: EventRow[] }> { return this.call('GET', `/admin/events?limit=${limit}${type ? `&type=${encodeURIComponent(type)}` : ''}`); }
  jobs(limit: number): Promise<{ jobs: JobEvent[] }> { return this.call('GET', `/admin/jobs?limit=${limit}`); }
  health(): Promise<{ ok: boolean; version: string; telegram: boolean; email: boolean; turnstile: boolean; db: boolean }> { return this.call('GET', '/health'); }
  testContact(): Promise<{ ok: boolean; delivered: string }> { return this.call('POST', '/admin/test-contact', {}); }
}
