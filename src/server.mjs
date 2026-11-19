import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { demoResponse, isDemoPage } from './demo.mjs';
import { explore } from './explorer.mjs';
import { explorePublic } from './public-explorer.mjs';
import { publicUrl } from './public-http.mjs';

const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/sample-report.json': ['sample-report.json', 'application/json; charset=utf-8'],
  '/demo/site.css': ['demo/site.css', 'text/css; charset=utf-8'],
  '/demo/site.js': ['demo/site.js', 'text/javascript; charset=utf-8']
};

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

function json(res, status, body) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(body));
}

async function readTarget(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') return null;
  let body = '';
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    body += chunk.toString();
    if (body.length > 2048) { req.resume(); return null; }
  }
  try { return JSON.parse(body)?.target ?? null; } catch { return null; }
}

export function resolveTarget(value, allowedOrigins) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (!allowedOrigins.has(url.origin) || url.username || url.password || url.search || url.hash) return null;
    if (url.pathname === '/demo') url.pathname = '/demo/';
    return isDemoPage(url.pathname) ? url.href : null;
  } catch { return null; }
}

export function createExplorerServer({ publicOrigin = process.env.PUBLIC_ORIGIN, railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN,
  cooldownMs = 2000 } = {}) {
  let active = false;
  let nextRunAt = 0;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && pathname === '/healthz') return json(res, 200, { status: 'ok' });
      if (req.method === 'POST' && pathname === '/api/runs') {
        const port = server.address().port;
        const base = `http://127.0.0.1:${port}`;
        const defaults = [base, `http://localhost:${port}`, `http://[::1]:${port}`];
        const origins = new Set(publicOrigin ? [new URL(publicOrigin).origin, ...defaults] : defaults);
        if (railwayDomain) origins.add(`https://${railwayDomain}`);
        const input = await readTarget(req);
        const target = resolveTarget(input, origins);
        const external = target ? null : publicUrl(input);
        if (!target && (!external || origins.has(external.origin))) {
          return json(res, 400, { error: 'Enter a public website address or a Fieldwork demo URL.' });
        }
        if (active || Date.now() < nextRunAt) return json(res, 429, { error: 'The explorer is busy. Wait a few seconds and try again.' });
        active = true;
        const client = new AbortController();
        res.once('close', () => client.abort());
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' });
        const publish = (message) => {
          if (!res.destroyed) res.write(`${JSON.stringify(message)}\n`);
        };
        publish({ type: 'started' });
        try {
          const onEvent = (event) => publish({ type: 'event', event });
          const report = external
            ? await explorePublic({ target: external.href, publish: onEvent, signal: client.signal })
            : await explore({ base, target, publish: onEvent });
          publish({ type: 'completed', report });
        } catch (error) {
          console.error('Exploration failed:', error.message);
          publish({ type: 'error', message: 'The exploration could not finish. Try again in a few seconds.' });
        } finally {
          active = false;
          nextRunAt = Date.now() + cooldownMs;
          res.end();
        }
        return;
      }
      const demo = demoResponse(req, pathname);
      if (demo) return send(res, ...demo);
      if (req.method === 'GET' && pathname === '/demo') {
        res.writeHead(308, { Location: '/demo/' });
        return res.end();
      }
      if (req.method === 'GET' && Object.hasOwn(assets, pathname)) {
        const [file, type] = assets[pathname];
        const content = await readFile(new URL(`../public/${file}`, import.meta.url));
        return send(res, 200, type, content);
      }
      return json(res, 404, { error: 'Page not found.' });
    } catch (error) {
      if (res.headersSent || res.destroyed) return res.end();
      if (error.code === 'ENOENT') return json(res, 404, { error: 'Page not found.' });
      console.error('Request failed:', error.message);
      return json(res, 500, { error: 'Something went wrong.' });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT || 3000);
  createExplorerServer().listen(port, process.env.HOST || '0.0.0.0', () => console.log(`AI Explorer is available at http://127.0.0.1:${port}`));
}
