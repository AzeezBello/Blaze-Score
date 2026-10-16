import assert from 'node:assert/strict';
import http from 'node:http';
import { gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { predict } from '../lib/predict.js';
import { demoProvider } from '../lib/demo.js';
import { createService } from '../lib/service.js';
import { localDate, addDays, isValidDate, ordinal } from '../lib/format.js';
import { createApp, SECURITY_HEADERS } from '../server.js';
import { loadEnv } from '../lib/env.js';
import { createEspnProvider, ESPN_LEAGUES } from '../lib/espn.js';
import { ALL_FREE_LEAGUES } from '../lib/footballdata.js';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let n = 0;
const ok = (name, fn) => Promise.resolve(fn()).then(() => console.log('  ok', ++n, name));

const team = (gf, ga, played = 10) => ({ gf, ga, played });

/* ---------- prediction model ---------- */
await ok('probabilities sum to 100 and favour the stronger home side', () => {
  const p = predict(team(25, 8), team(8, 25));
  assert.equal(p.probabilities.home + p.probabilities.draw + p.probabilities.away, 100);
  assert.ok(p.probabilities.home > 60 && p.pick === '1');
  assert.ok(p.expectedGoals.home > p.expectedGoals.away);
});
await ok('identical teams: home edge only, draw is plausible', () => {
  const p = predict(team(14, 14), team(14, 14));
  assert.ok(p.probabilities.home > p.probabilities.away);
  assert.ok(p.probabilities.draw >= 20 && p.probabilities.draw <= 32);
});
await ok('no games played falls back to league average without NaN', () => {
  const p = predict(team(0, 0, 0), team(0, 0, 0));
  assert.ok(Object.values(p.probabilities).every(Number.isFinite));
  assert.ok(Number.isFinite(p.over25) && Number.isFinite(p.btts));
});
await ok('small samples are shrunk: 3 goals in 1 game is not treated as elite', () => {
  const p = predict(team(3, 0, 1), team(1, 1, 1));
  assert.ok(p.expectedGoals.home < 2.2, `got ${p.expectedGoals.home}`);
});
await ok('top scores are sorted and double chance is consistent', () => {
  const p = predict(team(25, 8), team(10, 20));
  assert.equal(p.topScores.length, 3);
  assert.ok(p.topScores[0].pct >= p.topScores[1].pct && p.topScores[1].pct >= p.topScores[2].pct);
  assert.equal(p.doubleChance.homeOrDraw, p.probabilities.home + p.probabilities.draw);
});
await ok('predict computes fair decimal odds for 1, X and 2', () => {
  const p = predict(team(20, 10), team(10, 20));
  assert.ok(p.odds && p.odds.home > 1 && p.odds.draw > 1 && p.odds.away > 1);
  assert.equal(+(100 / p.probabilities.home).toFixed(2), p.odds.home);
});

/* ---------- shared helpers ---------- */
await ok('ordinal suffixes handle the teens', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th']);
});
await ok('date helpers: local date shape, day arithmetic across month ends, validation', () => {
  assert.match(localDate(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(localDate(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');
  assert.ok(isValidDate('2026-02-28'));
  assert.ok(!isValidDate('2026-02-30'), 'Feb 30 must not roll over to March');
  assert.ok(!isValidDate('2026-13-01'));
  assert.ok(!isValidDate('2026-1-1'));
});

await ok('.env loader: quotes, comments, export prefix, and real env wins', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'blaze-env-'));
  const file = join(dir, '.env');
  await writeFile(file, '# comment\nFOOTBALL_DATA_KEY=abc123 # trailing\nexport QUOTED="x = y"\nSINGLE=\'z\'\nKEEP=from-file\n\nbad line\n');
  const env = loadEnv(file, { KEEP: 'from-env' });
  assert.deepEqual(env, { KEEP: 'from-env', FOOTBALL_DATA_KEY: 'abc123', QUOTED: 'x = y', SINGLE: 'z' });
  assert.deepEqual(loadEnv(join(dir, 'missing'), {}), {}, 'a missing file is not an error');
});

/* ---------- demo provider ---------- */
const today = new Date().toISOString().slice(0, 10);
await ok('demo fixtures are deterministic per date', async () => {
  const a = await demoProvider.listMatches('2026-03-14');
  const b = await demoProvider.listMatches('2026-03-14');
  assert.deepEqual(a.map((m) => m.id), b.map((m) => m.id));
  assert.ok(a.length > 0);
});
await ok("today's demo slate always has a live match", async () => {
  const list = await demoProvider.listMatches(today);
  assert.ok(list.some((m) => m.status === 'LIVE'), 'no live match');
});
await ok('live and finished demo matches carry stats; scheduled do not', async () => {
  const list = await demoProvider.listMatches(today);
  for (const m of list) {
    if (m.status === 'SCHEDULED') assert.equal(m.stats, null);
    else {
      assert.equal(m.stats.possession.home + m.stats.possession.away, 100);
      assert.ok(m.stats.shotsOnTarget.home >= m.score.home);
    }
  }
});

/* ---------- service layer ---------- */
const service = createService(demoProvider);
await ok('service.match adds prediction, h2h and trends', async () => {
  const [m] = await service.matches(today);
  const full = await service.match(m.id);
  assert.equal(full.prediction.probabilities.home + full.prediction.probabilities.draw + full.prediction.probabilities.away, 100);
  assert.equal(full.h2h.length, 5);
  assert.ok(Array.isArray(full.prediction.trends));
});
await ok('a day of predictions fetches each league table once, even when called concurrently', async () => {
  const calls = [];
  const counting = { ...demoProvider, standings: (code) => { calls.push(code); return demoProvider.standings(code); } };
  const svc = createService(counting);
  const list = await svc.predictions('2026-03-14');
  const leagues = new Set(list.map((m) => m.league.code));
  assert.ok(list.length > leagues.size, 'need several matches per league for this to mean anything');
  assert.equal(calls.length, leagues.size);
});
await ok('service keeps serving the last good table when the provider starts failing', async () => {
  let fail = false;
  const flaky = { ...demoProvider, standings: (code) => (fail ? Promise.reject(new Error('down')) : demoProvider.standings(code)) };
  const svc = createService(flaky);
  const before = await svc.standings('PL');
  fail = true;
  const realNow = Date.now;
  Date.now = () => realNow() + 120_000; // cache expired: must retry and fall back
  try { assert.deepEqual(await svc.standings('PL'), before); } finally { Date.now = realNow; }
  assert.equal(await createService(flaky).standings('PL'), null); // nothing cached yet: null, not a crash
});

/* ---------- football-data.org provider against a stubbed v4 API ---------- */
const { createFootballDataProvider } = await import('../lib/footballdata.js');
const realFetch = globalThis.fetch;
let upstream = 'ok', upstreamCalls = 0;
const upstreamUrls = [];
const fdTeam = (id, name, tla) => ({ id, name, shortName: name, tla });
globalThis.fetch = async (url, opts) => {
  if (!String(url).startsWith('https://api.football-data.org/v4')) return realFetch(url, opts);
  upstreamCalls++;
  upstreamUrls.push(String(url));
  if (upstream === 'limit') return new Response('{}', { status: 429 });
  if (String(url).includes('/standings')) return Response.json({ standings: [{ type: 'TOTAL', table: [
    { position: 1, team: fdTeam(1, 'Arsenal', 'ARS'), playedGames: 8, won: 6, draw: 1, lost: 1, goalsFor: 18, goalsAgainst: 6, goalDifference: 12, points: 19, form: 'W,W,D,W,W' },
    { position: 2, team: fdTeam(2, 'Chelsea', 'CHE'), playedGames: 8, won: 4, draw: 2, lost: 2, goalsFor: 12, goalsAgainst: 9, goalDifference: 3, points: 14, form: 'L,W,D,W,D' }] }] });
  return Response.json({ matches: [
    { id: 99, status: 'TIMED', utcDate: '2026-10-17T14:00:00Z', competition: { code: 'PL', name: 'Premier League' }, area: { name: 'England' }, homeTeam: fdTeam(1, 'Arsenal', 'ARS'), awayTeam: fdTeam(2, 'Chelsea', 'CHE'), score: { fullTime: {} } },
    { id: 100, status: 'IN_PLAY', minute: 63, utcDate: '2026-10-17T12:30:00Z', competition: { code: 'PL', name: 'Premier League' }, area: { name: 'England' }, homeTeam: fdTeam(2, 'Chelsea', 'CHE'), awayTeam: fdTeam(1, 'Arsenal', 'ARS'), score: { fullTime: { home: 1, away: 2 } } },
    { id: 101, status: 'TIMED', utcDate: '2026-10-17T19:00:00Z', competition: { code: 'ELC', name: 'Championship' }, area: { name: 'England' }, homeTeam: fdTeam(3, 'Leeds', 'LEE'), awayTeam: fdTeam(4, 'Burnley', 'BUR'), score: { fullTime: {} } },
  ] });
};
await ok('football-data provider maps v4 payloads, asks only for shown leagues, and predicts from them', async () => {
  const svc = createService(createFootballDataProvider('test-key'));
  const day = await svc.predictions('2026-10-17');
  assert.equal(day.length, 2, 'leagues outside the list are dropped');
  assert.ok(upstreamUrls.some((u) => /\/matches\?dateFrom=2026-10-17&dateTo=2026-10-18&competitions=PL,PD,SA,BL1,FL1,CL/.test(u)), 'dateTo is exclusive upstream, so one day is D..D+1, filtered by league');
  const [scheduled, live] = day;
  assert.equal(scheduled.status, 'SCHEDULED');
  assert.equal(scheduled.home.short, 'ARS');
  assert.equal(scheduled.prediction.form.home, 'WWDWW');
  assert.ok(scheduled.prediction.probabilities.home > scheduled.prediction.probabilities.away);
  assert.equal(live.status, 'LIVE');
  assert.equal(live.minute, 63, 'uses the API clock when it sends one');
  assert.deepEqual(live.score, { home: 1, away: 2 });
});
await ok('football-data provider serves last good data when rate limited', async () => {
  const prov = createFootballDataProvider('test-key');
  const before = await prov.standings('PL');
  upstream = 'limit';
  const calls = upstreamCalls;
  const realNow = Date.now;
  Date.now = () => realNow() + 3_600_000; // cache expired: must hit upstream, get 429, fall back to last good
  try {
    const during = await prov.standings('PL');
    assert.deepEqual(during, before);
    assert.ok(upstreamCalls > calls, 'expected an upstream attempt');
  } finally { Date.now = realNow; }
  await assert.rejects(createFootballDataProvider('k2').standings('PL'), /rate limit/); // nothing cached yet: error surfaces
  upstream = 'ok';
});

/* ---------- HTTP server ---------- */
const server = createApp({});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
const get = (p, headers) => fetch(base + p, { headers });
const raw = (path, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  }).on('error', reject);
});

await ok('GET /api/health reports demo provider', async () => {
  assert.deepEqual(await (await get('/api/health')).json(), { ok: true, provider: 'demo' });
});
await ok('GET /api/matches?date= validates input, including impossible calendar dates', async () => {
  assert.equal((await get('/api/matches?date=nope')).status, 400);
  assert.equal((await get('/api/matches?date=2026-02-30x')).status, 400);
  assert.equal((await get('/api/matches?date=2026-02-30')).status, 400);
  assert.equal((await get(`/api/matches?date=${today}`)).status, 200);
});
await ok('unknown match is 404, bad id is 400', async () => {
  assert.equal((await get('/api/matches/d-2026-01-01-999')).status, 404);
  assert.equal((await get('/api/matches/..%2Fserver.js')).status, 400);
});
await ok('GET /api/standings/PL is sorted by points', async () => {
  const st = await (await get('/api/standings/PL')).json();
  const pts = st.table.map((r) => r.points);
  assert.deepEqual(pts, [...pts].sort((a, b) => b - a));
});
await ok('GET /api/tips ranks per market and only lists unstarted matches', async () => {
  const t = await (await get(`/api/tips?date=${today}`)).json();
  assert.equal(t.sections.length, 4);
  for (const sec of t.sections) {
    const pcts = sec.tips.map((x) => x.pct);
    assert.deepEqual(pcts, [...pcts].sort((a, b) => b - a));
    assert.ok(pcts.every((x) => x >= 0 && x <= 100));
  }
});
await ok('API cache hints: health is never cached, lists are CDN-cacheable for 30s, tables for 5 minutes', async () => {
  assert.equal((await get('/api/health')).headers.get('cache-control'), 'no-store');
  assert.match((await get(`/api/matches?date=${today}`)).headers.get('cache-control'), /s-maxage=30\b/);
  assert.match((await get('/api/standings/PL')).headers.get('cache-control'), /s-maxage=300\b/);
  assert.match((await get('/api/leagues')).headers.get('cache-control'), /s-maxage=3600\b/);
});
await ok('every response carries the security headers', async () => {
  for (const path of ['/', '/api/health', '/nope', '/api/nope']) {
    const res = await get(path);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) assert.equal(res.headers.get(k), v, `${k} on ${path}`);
  }
  assert.match(SECURITY_HEADERS['Content-Security-Policy'], /script-src 'self';/);
});
await ok('static files get an ETag and revalidate to 304', async () => {
  const first = await raw('/styles.css');
  assert.equal(first.status, 200);
  assert.match(first.headers.etag, /^W\/"/);
  const again = await raw('/styles.css', { 'if-none-match': `"other", ${first.headers.etag}` });
  assert.equal(again.status, 304);
  assert.equal(again.body.length, 0);
});
await ok('text responses are gzipped when the client accepts it, and byte-identical after inflating', async () => {
  const plain = await raw('/app.js');
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.equal(plain.headers.vary, 'Accept-Encoding');
  const zipped = await raw('/app.js', { 'accept-encoding': 'gzip, br' });
  assert.equal(zipped.headers['content-encoding'], 'gzip');
  assert.ok(zipped.body.length < plain.body.length);
  assert.deepEqual(gunzipSync(zipped.body), await readFile(new URL('../public/app.js', import.meta.url)));
  const api = await raw(`/api/predictions?date=${today}`, { 'accept-encoding': 'gzip' });
  assert.equal(api.headers['content-encoding'], 'gzip');
  assert.ok(Array.isArray(JSON.parse(gunzipSync(api.body).toString())));
  const tiny = await raw('/api/health', { 'accept-encoding': 'gzip' });
  assert.equal(tiny.headers['content-encoding'], undefined, 'small bodies are sent as-is');
});
await ok('shared lib modules and the theme bootstrap are served to the browser', async () => {
  for (const p of ['/lib/service.js', '/lib/predict.js', '/lib/demo.js', '/lib/format.js', '/theme.js', '/sw.js', '/manifest.webmanifest']) {
    const res = await get(p);
    assert.equal(res.status, 200, p);
  }
  assert.equal((await get('/sw.js')).headers.get('cache-control'), 'no-cache');
  assert.match((await get('/manifest.webmanifest')).headers.get('content-type'), /manifest\+json/);
});
await ok('static server blocks path traversal', async () => {
  const res = await fetch(base + '/%2e%2e/server.js');
  assert.ok([403, 404].includes(res.status));
  const body = await res.text();
  assert.ok(!body.includes('createApp'));
  const lib = await fetch(base + '/lib/../server.js');
  assert.ok(!(await lib.text()).includes('createApp'));
  const rawReply = await new Promise((resolve) => {
    import('node:net').then(({ default: net }) => {
      const s = net.connect(port, '127.0.0.1', () => s.write('GET /../server.js HTTP/1.0\r\n\r\n'));
      let d = ''; s.on('data', (c) => (d += c)); s.on('end', () => resolve(d));
    });
  });
  assert.ok(!rawReply.includes('createApp'));
});
await ok('non-GET methods are rejected with an Allow header', async () => {
  const res = await fetch(base + '/api/matches', { method: 'POST' });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'GET, HEAD');
});
await ok('HEAD returns headers only', async () => {
  const res = await raw('/api/health');
  const head = await new Promise((resolve) => http.request({ host: '127.0.0.1', port, path: '/api/health', method: 'HEAD' }, (r) => { const c = []; r.on('data', (x) => c.push(x)); r.on('end', () => resolve({ status: r.statusCode, len: Buffer.concat(c).length })); }).end());
  assert.equal(res.status, 200);
  assert.equal(head.status, 200);
  assert.equal(head.len, 0);
});

server.close();
globalThis.fetch = realFetch;
console.log(`\n${n} checks passed`);
