// Server statico minimo per provare l'app in locale: `npm start` (porta 8080, o PORT).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = resolve(join(root, normalize(path === '/' ? '/index.html' : path)));
  if (!file.startsWith(root + '/') || /\/(test|node_modules)\//.test(file) || file.endsWith('serve.js')) { res.writeHead(404).end('Not found'); return; }
  try { const data = await readFile(file); res.writeHead(200, { 'content-type': (types[extname(file)] || 'application/octet-stream') + '; charset=utf-8' }).end(data); }
  catch { res.writeHead(404).end('Not found'); }
}).listen(process.env.PORT || 8080, () => console.log('http://localhost:' + (process.env.PORT || 8080)));
