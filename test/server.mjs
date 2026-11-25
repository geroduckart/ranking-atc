// Servidor local de pruebas: sirve /public y manda /api/* a la función.
import './fakeclock.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
process.env.DATABASE_URL ||= 'postgres://postgres:pg@127.0.0.1:5432/ranking';
process.env.SESSION_SECRET ||= 'test-secret-test-secret-test-secret';
process.env.ADMIN_USERNAME ||= 'gero';
process.env.SITE_URL ||= 'http://localhost:8888';
const { default: api } = await import('../netlify/functions/api.mjs');
const root = path.resolve('public');
const types = { '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.json': 'application/json', '.txt': 'text/plain' };
http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await api(new Request('http://localhost:8888' + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  let f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (f.endsWith('/')) f += 'index.html';
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(8888, () => console.log('http://localhost:8888'));
