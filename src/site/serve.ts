// Zero-dependency static server for previewing dist/ locally (`drift serve`).
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { log } from '../core/logger.js';

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.xml': 'application/xml', '.txt': 'text/plain' };

export function serveStatic(dir: string, port: number): Promise<() => void> {
  const logger = log('serve');
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    let file = normalize(join(dir, urlPath));
    if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { file = join(dir, '404.html'); res.statusCode = 404; }
    if (!existsSync(file)) { res.writeHead(404).end('not found'); return; }
    res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, () => { logger.info(`serving ${dir} at http://localhost:${port}`); resolve(() => server.close()); }));
}
