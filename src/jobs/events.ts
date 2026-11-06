// Best-effort job event reporting to the worker's event store (D1), so `drift logs --remote`
// and the dashboard can show sync history next to web analytics. Never throws.
import { Config } from '../core/config.js';
import { secret } from '../core/env.js';
import { errorData, log } from '../core/logger.js';

const logger = log('events');

export async function postJobEvent(config: Config, type: string, status: 'ok' | 'error', summary: Record<string, unknown>): Promise<void> {
  const token = secret('DRIFT_ADMIN_TOKEN');
  const url = config.worker.url.replace(/\/+$/, '');
  if (!token || !url) { logger.debug('worker not configured; job event kept local only', { type, status }); return; }
  try {
    const res = await fetch(`${url}/admin/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ type, status, summary }),
    });
    if (!res.ok) logger.warn('job event rejected', { status: res.status });
  } catch (err) {
    logger.warn('job event failed', errorData(err));
  }
}
