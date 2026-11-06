// drift.config.json: the single, committed, non-secret source of truth for the whole system.
// The CLI edits it (`drift config set`, `drift contact set`, `drift schedule set`), the site
// build reads it, and the worker deploy turns the `contact`/`site` sections into Worker vars.
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { PATHS } from './paths.js';

export const ConfigSchema = z.object({
  dealer: z.object({
    name: z.string().min(1),
    tagline: z.string().default(''),
    about: z.string().default(''),
    phoneDisplay: z.string().default(''),
    address: z.string().default(''),
    city: z.string().default(''),
    hours: z.array(z.string()).default([]),
    kslProfileUrl: z.string().default(''),
    facebookUrl: z.string().default(''),
  }),
  site: z.object({
    url: z.string().default(''),
    title: z.string().default(''),
    showSold: z.boolean().default(true),
    soldDays: z.number().int().positive().default(60),
    featuredCount: z.number().int().positive().default(8),
    showPhone: z.boolean().default(true),
  }),
  sources: z.object({
    ksl: z.object({
      enabled: z.boolean().default(true),
      memberId: z.string().default(''),
      requestDelayMs: z.number().int().nonnegative().default(1500),
      detailRefreshHours: z.number().positive().default(24),
      maxPages: z.number().int().positive().default(25),
    }),
    manual: z.object({ enabled: z.boolean().default(true) }),
  }),
  sync: z.object({
    cron: z.string().default('17 */2 * * *'),
    notify: z.enum(['changes', 'always', 'never']).default('changes'),
  }),
  contact: z.object({
    phone: z.string().default(''),
    email: z.string().default(''),
    telegramChatId: z.string().default(''),
    methods: z.array(z.enum(['telegram', 'email'])).default(['telegram']),
    turnstileSiteKey: z.string().default(''),
    fromEmail: z.string().default('leads@notifications.example.com'),
  }),
  worker: z.object({
    name: z.string().default('drift'),
    url: z.string().default(''),
    d1DatabaseId: z.string().default(''),
  }),
  analytics: z.object({
    enabled: z.boolean().default(true),
    ipMode: z.enum(['hash', 'full']).default('hash'),
  }),
  digest: z.object({
    enabled: z.boolean().default(true),
    cron: z.string().default('0 14 * * *'),
    timezone: z.string().default('America/Denver'),
  }),
});
export type Config = z.infer<typeof ConfigSchema>;

let cached: Config | undefined;

export function loadConfig(path: string = PATHS.config): Config {
  if (cached && path === PATHS.config) return cached;
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`drift.config.json is invalid:\n${issues}`);
  }
  if (path === PATHS.config) cached = parsed.data;
  return parsed.data;
}

export function saveConfig(config: Config, path: string = PATHS.config): void {
  const parsed = ConfigSchema.parse(config);
  writeFileSync(path, JSON.stringify(parsed, null, 2) + '\n');
  if (path === PATHS.config) cached = parsed;
}

/** Reads a dotted path like "contact.phone". */
export function getPath(obj: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), obj);
}

/** Sets a dotted path, coercing the string value to the existing type (number/boolean/array/json). */
export function setPath(obj: Record<string, unknown>, dotted: string, rawValue: string): void {
  const keys = dotted.split('.');
  let cur: Record<string, unknown> = obj;
  for (const key of keys.slice(0, -1)) {
    if (typeof cur[key] !== 'object' || cur[key] === null) cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  const last = keys[keys.length - 1]!;
  const existing = cur[last];
  let value: unknown = rawValue;
  if (typeof existing === 'number') value = Number(rawValue);
  else if (typeof existing === 'boolean') value = rawValue === 'true';
  else if (Array.isArray(existing)) value = rawValue.startsWith('[') ? JSON.parse(rawValue) : rawValue.split(',').map((s) => s.trim()).filter(Boolean);
  else if (rawValue.startsWith('{') || rawValue.startsWith('[')) value = JSON.parse(rawValue);
  cur[last] = value;
}

/** Site base URL without trailing slash; falls back to the GitHub Pages URL when running in Actions. */
export function siteUrl(config: Config): string {
  const fromConfig = config.site.url.replace(/\/+$/, '');
  if (fromConfig) return fromConfig;
  const repo = process.env.GITHUB_REPOSITORY; // owner/name
  if (repo) {
    const [owner, name] = repo.split('/');
    return `https://${owner!.toLowerCase()}.github.io/${name}`;
  }
  return 'http://localhost:4321';
}
