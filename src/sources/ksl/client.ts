// Polite HTTP client for cars.ksl.com: browser-like headers, fixed delay between requests,
// retries with backoff on 429/5xx. Everything the KSL adapter fetches goes through here so
// request volume is easy to reason about and log.
import { Logger, log } from '../../core/logger.js';

export interface KslClientOptions {
  delayMs: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  logger?: Logger;
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export class HttpStatusError extends Error {
  constructor(public readonly status: number, public readonly url: string) {
    super(`HTTP ${status} for ${url}`);
  }
}

export class KslClient {
  private lastRequestAt = 0;
  public requests = 0;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly opts: KslClientOptions) {
    this.logger = opts.logger ?? log('ksl:http');
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async getHtml(url: string): Promise<string> {
    const maxRetries = this.opts.maxRetries ?? 3;
    for (let attempt = 0; ; attempt++) {
      await this.throttle();
      const started = Date.now();
      this.requests++;
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9' },
          redirect: 'follow',
        });
      } catch (err) {
        if (attempt >= maxRetries) throw err;
        this.logger.warn('network error, retrying', { url, attempt, error: String(err) });
        await sleep(backoff(attempt));
        continue;
      }
      const ms = Date.now() - started;
      this.logger.debug('GET', { url, status: res.status, ms });
      if (res.ok) return await res.text();
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= maxRetries) throw new HttpStatusError(res.status, url);
      this.logger.warn(`HTTP ${res.status}, retrying`, { url, attempt });
      await sleep(backoff(attempt));
    }
  }

  private async throttle(): Promise<void> {
    const wait = this.lastRequestAt + this.opts.delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }
}

const backoff = (attempt: number): number => Math.min(30_000, 2_000 * 2 ** attempt);
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
