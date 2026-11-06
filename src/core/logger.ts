// Structured logger used by the CLI and jobs.
//  - Pretty, colored lines on a TTY; JSON lines in CI (easy to grep in Actions logs).
//  - Every line is also appended to .drift/drift.log as JSON so `drift logs` can show history.
//  - Level via DRIFT_LOG=debug|info|warn|error (default info). `--verbose` sets debug.
import { appendFileSync, mkdirSync } from 'node:fs';
import { PATHS } from './paths.js';
import { isCI } from './env.js';

export type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogEntry {
  ts: string;
  level: Level;
  scope: string;
  msg: string;
  data?: Record<string, unknown>;
}

const C = {
  dim: '\x1b[2m', reset: '\x1b[0m', red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', cyan: '\x1b[36m', bold: '\x1b[1m',
};
const LEVEL_COLOR: Record<Level, string> = { debug: C.dim, info: C.cyan, warn: C.yellow, error: C.red };

let minLevel: Level = (process.env.DRIFT_LOG as Level) || 'info';
let fileEnabled = true;

export function setLogLevel(level: Level): void { minLevel = level; }
export function disableLogFile(): void { fileEnabled = false; }

function writeFile(entry: LogEntry): void {
  if (!fileEnabled) return;
  try {
    mkdirSync(PATHS.localState, { recursive: true });
    appendFileSync(PATHS.localLog, JSON.stringify(entry) + '\n');
  } catch { /* logging must never crash the job */ }
}

function format(entry: LogEntry): string {
  const useColor = process.stdout.isTTY && !isCI();
  if (isCI() || process.env.DRIFT_LOG_JSON === '1') return JSON.stringify(entry);
  const time = entry.ts.slice(11, 19);
  const lvl = entry.level.toUpperCase().padEnd(5);
  const data = entry.data && Object.keys(entry.data).length ? ' ' + JSON.stringify(entry.data) : '';
  if (!useColor) return `${time} ${lvl} [${entry.scope}] ${entry.msg}${data}`;
  return `${C.dim}${time}${C.reset} ${LEVEL_COLOR[entry.level]}${lvl}${C.reset} ${C.bold}[${entry.scope}]${C.reset} ${entry.msg}${C.dim}${data}${C.reset}`;
}

export class Logger {
  constructor(private readonly scope: string) {}
  child(scope: string): Logger { return new Logger(`${this.scope}:${scope}`); }
  private emit(level: Level, msg: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = { ts: new Date().toISOString(), level, scope: this.scope, msg, ...(data ? { data } : {}) };
    writeFile(entry);
    if (ORDER[level] < ORDER[minLevel]) return;
    const line = format(entry);
    if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  }
  debug(msg: string, data?: Record<string, unknown>): void { this.emit('debug', msg, data); }
  info(msg: string, data?: Record<string, unknown>): void { this.emit('info', msg, data); }
  warn(msg: string, data?: Record<string, unknown>): void { this.emit('warn', msg, data); }
  error(msg: string, data?: Record<string, unknown>): void { this.emit('error', msg, data); }
}

export const log = (scope: string): Logger => new Logger(scope);

export function errorData(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { error: err.message, ...(process.env.DRIFT_LOG === 'debug' ? { stack: err.stack } : {}) };
  return { error: String(err) };
}
