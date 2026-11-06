// Secrets come only from the environment (or a local .env file). They are never
// written to drift.config.json. Every secret is optional so partial setups still run.
import { readFileSync, existsSync } from 'node:fs';
import { PATHS } from './paths.js';

const SECRET_NAMES = [
  'TELEGRAM_BOT_TOKEN',
  'DRIFT_ADMIN_TOKEN',
  'DRIFT_DASHBOARD_TOKEN',
  'RESEND_API_KEY',
  'TURNSTILE_SECRET_KEY',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

let loaded = false;

/** Loads .env into process.env once (existing env vars win). */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  if (!existsSync(PATHS.envFile)) return;
  for (const raw of readFileSync(PATHS.envFile, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function secret(name: SecretName): string | undefined {
  loadEnv();
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export function requireSecret(name: SecretName, why: string): string {
  const v = secret(name);
  if (!v) throw new Error(`Missing ${name} (${why}). Add it to .env or the environment. See .env.example.`);
  return v;
}

export function secretStatus(): Record<SecretName, boolean> {
  loadEnv();
  return Object.fromEntries(SECRET_NAMES.map((n) => [n, Boolean(secret(n))])) as Record<SecretName, boolean>;
}

export const isCI = (): boolean => process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
