// Zero-dependency server: serves the PWA and a small JSON API.
// The match data provider is picked by environment:
//   FOOTBALL_DATA_KEY=...  -> football-data.org (real data)
//   (nothing)              -> built-in demo data

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createService } from './lib/service.js';
import { demoProvider } from './lib/demo.js';
import { createFootballDataProvider } from './lib/footballdata.js';
import { createEspnProvider } from './lib/espn.js';
import { isValidDate } from './lib/format.js';
import { loadEnv } from './lib/env.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = resolve(ROOT, 'public');
const LIB = resolve(ROOT, 'lib');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

// Sent with every response. Only same-origin code may run; styles may be inline
// (the templates set a few style attributes) and fonts come from Google Fonts.
// vercel.json repeats these for the statically served files.
export const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data: https://a.espncdn.com https://crests.football-data.org",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

// Browsers always revalidate (max-age=0). A CDN in front (Vercel) may serve a copy
// for s-maxage seconds, which keeps football-data.org's 10 requests/minute budget
// safe even when several serverless instances run with separate memory caches.
const CACHE = {
  none: 'no-store',
  short: 'public, max-age=0, s-maxage=30, stale-while-revalidate=120',
  standings: 'public, max-age=0, s-maxage=300, stale-while-revalidate=600',
  leagues: 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
};

const ID_RE = /^[A-Za-z0-9-]{1,40}$/;
const CODE_RE = /^[A-Z0-9]{2,5}$/;
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|manifest)|image\/svg)/;
const MIN_GZIP_BYTES = 1024;

export function createApp(env = process.env) {
  const demoSvc = createService(demoProvider);
  let espnSvc = null;
  const getEspnSvc = () => (espnSvc ??= createService(createEspnProvider()));
  const fdSvc = env.FOOTBALL_DATA_KEY ? createService(createFootballDataProvider(env.FOOTBALL_DATA_KEY)) : null;

  let defaultSvc = demoSvc;
  if (env.DATA_PROVIDER === 'espn') {
    defaultSvc = getEspnSvc();
  } else if (env.DATA_PROVIDER === 'football-data' && fdSvc) {
    defaultSvc = fdSvc;
  } else if (env.DATA_PROVIDER === 'demo') {
    defaultSvc = demoSvc;
  } else if (env.FOOTBALL_DATA_KEY && fdSvc) {
    defaultSvc = fdSvc;
  }

  function resolveService(url, matchId = '') {
    if (matchId.startsWith('espn-')) return getEspnSvc();
    if (matchId.startsWith('fd-') && fdSvc) return fdSvc;
    if (matchId.startsWith('d-')) return demoSvc;

    const p = url.searchParams.get('provider');
    if (p === 'espn') return getEspnSvc();
    if (p === 'demo') return demoSvc;
    if ((p === 'football-data' || p === 'footballdata') && fdSvc) return fdSvc;
    return defaultSvc;
  }

  const compress = !env.VERCEL; // Vercel's edge already compresses function and static responses

  function send(req, res, status, body, headers) {
    const h = { ...SECURITY_HEADERS, ...headers };
    let out = typeof body === 'string' ? Buffer.from(body) : body;
    if (compress && COMPRESSIBLE.test(h['Content-Type'] ?? '')) {
      h.Vary = 'Accept-Encoding';
      if (out.length >= MIN_GZIP_BYTES && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
        out = gzipSync(out);
        h['Content-Encoding'] = 'gzip';
      }
    }
    res.writeHead(status, h);
    res.end(out);
  }

  const json = (req, res, status, body, cache = CACHE.none) =>
    send(req, res, status, JSON.stringify(body), { 'Content-Type': MIME['.json'], 'Cache-Control': cache });

  async function api(req, url, res) {
    const path = url.pathname;
    const reply = (status, body, cache) => json(req, res, status, body, cache);
    const service = resolveService(url);

    if (path === '/api/health') return reply(200, { ok: true, provider: service.providerName });
    if (path === '/api/providers') {
      return reply(200, {
        active: service.providerName,
        providers: [
          { id: 'espn', name: 'ESPN Live', label: 'Free Live Data', description: 'Zero API keys required, live clock, match statistics and lineups', ready: true },
          { id: 'demo', name: 'Demo Simulation', label: 'Simulated Data', description: 'Deterministic fixtures that play in real time, offline friendly', ready: true },
          { id: 'football-data', name: 'football-data.org', label: 'API Key Tier', description: '12 competitions on football-data.org free tier', ready: Boolean(env.FOOTBALL_DATA_KEY) },
        ],
      }, CACHE.short);
    }
    if (path === '/api/leagues') return reply(200, await service.leagues(), CACHE.leagues);

    if (path === '/api/matches' || path === '/api/predictions' || path === '/api/tips') {
      const date = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
      if (!isValidDate(date)) return reply(400, { error: 'date must be a real YYYY-MM-DD date' });
      return reply(200, await service[path.slice('/api/'.length)](date), CACHE.short);
    }

    let m = /^\/api\/matches\/([^/]+)$/.exec(path);
    if (m) {
      if (!ID_RE.test(m[1])) return reply(400, { error: 'bad match id' });
      const matchSvc = resolveService(url, m[1]);
      const match = await matchSvc.match(m[1]);
      return match ? reply(200, match, CACHE.short) : reply(404, { error: 'match not found' });
    }
    m = /^\/api\/standings\/([^/]+)$/.exec(path);
    if (m) {
      if (!CODE_RE.test(m[1])) return reply(400, { error: 'bad league code' });
      const st = await service.standings(m[1]);
      return st ? reply(200, st, CACHE.standings) : reply(404, { error: 'league not found' });
    }
    return reply(404, { error: 'not found' });
  }

  async function serveStatic(req, pathname, res) {
    let base = PUBLIC;
    let rel = pathname === '/' ? '/index.html' : pathname;
    if (rel.startsWith('/lib/')) { base = LIB; rel = rel.slice('/lib'.length); } // browser fallback imports shared code
    let file;
    try { file = normalize(join(base, decodeURIComponent(rel))); } catch { file = ''; }
    if (!file.startsWith(base + sep)) return send(req, res, 403, 'Forbidden', { 'Content-Type': MIME['.txt'] });

    let body;
    try { body = await readFile(file); } catch { return send(req, res, 404, 'Not found', { 'Content-Type': MIME['.txt'] }); }

    const ext = extname(file);
    const etag = `W/"${createHash('sha1').update(body).digest('base64url').slice(0, 20)}"`;
    const headers = {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': ext === '.html' || file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=300',
      ETag: etag,
    };
    const inm = (req.headers['if-none-match'] ?? '').split(',').map((s) => s.trim());
    if (inm.includes(etag)) { res.writeHead(304, { ...SECURITY_HEADERS, ...headers }); return res.end(); }
    return send(req, res, 200, body, headers);
  }

  return http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { ...SECURITY_HEADERS, Allow: 'GET, HEAD' });
        return res.end();
      }
      let url;
      try { url = new URL(req.url, 'http://localhost'); } catch { return json(req, res, 400, { error: 'bad request' }); }
      if (url.pathname.startsWith('/api/')) return await api(req, url, res);
      return await serveStatic(req, url.pathname, res);
    } catch (err) {
      console.error(err);
      if (res.headersSent) return res.end();
      json(req, res, 502, { error: 'Match data is unavailable right now. Try again shortly.' });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadEnv(); // picks up FOOTBALL_DATA_KEY from .env when present
  if (!process.env.DATA_PROVIDER && !process.env.FOOTBALL_DATA_KEY) {
    process.env.DATA_PROVIDER = 'espn';
  }
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  createApp().listen(port, host, () => {
    const name = process.env.DATA_PROVIDER === 'espn' ? 'ESPN (Free live data)' : process.env.FOOTBALL_DATA_KEY ? 'football-data.org' : 'demo data';
    console.log(`Blaze Score on http://${host}:${port} (${name})`);
  });
}
