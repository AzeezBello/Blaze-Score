// Exercise the real football-data.org API with your key and report what comes
// back, so a bad key, a plan limit or a changed payload shows up here and not
// in the app. Usage: FOOTBALL_DATA_KEY=... node scripts/check-api.mjs
import { loadEnv } from '../lib/env.js';
import { createFootballDataProvider } from '../lib/footballdata.js';
import { createService } from '../lib/service.js';

loadEnv();
const key = process.env.FOOTBALL_DATA_KEY;
if (!key) {
  console.error('FOOTBALL_DATA_KEY is not set. Put it in .env or pass it on the command line.');
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const headers = { 'X-Auth-Token': key };
const raw = await fetch(`https://api.football-data.org/v4/matches?dateFrom=${today}&dateTo=${today}`, { headers });
console.log(`GET /v4/matches  -> ${raw.status} ${raw.statusText}`);
console.log(`  requests left this minute: ${raw.headers.get('x-requests-available-minute') ?? '?'}`);
if (raw.status === 403 || raw.status === 400) {
  console.error('  The key was rejected. Check it at https://www.football-data.org/client/home');
  process.exit(1);
}
if (!raw.ok) { console.error('  Upstream error:', await raw.text()); process.exit(1); }
const body = await raw.json();
const comps = [...new Set((body.matches ?? []).map((m) => m.competition.code))];
console.log(`  ${body.resultSet?.count ?? body.matches?.length ?? 0} matches today across ${comps.join(', ') || 'no competitions'}`);
const sample = body.matches?.find((m) => m.status === 'IN_PLAY' || m.status === 'PAUSED') ?? body.matches?.[0];
if (sample) console.log(`  sample: ${sample.homeTeam.shortName ?? sample.homeTeam.name} v ${sample.awayTeam.shortName ?? sample.awayTeam.name} status=${sample.status} minute=${sample.minute ?? 'n/a'} score=${sample.score?.fullTime?.home ?? '-'}-${sample.score?.fullTime?.away ?? '-'}`);

// Now through the app's own provider and service, exactly as /api/* would serve it.
const service = createService(createFootballDataProvider(key));
const list = await service.predictions(today);
const live = list.filter((m) => m.status === 'LIVE').length;
console.log(`\nvia app service: ${list.length} matches in the shown leagues (${live} live)`);
for (const m of list.slice(0, 5)) {
  const p = m.prediction.probabilities;
  console.log(`  ${m.league.code} ${m.home.name} v ${m.away.name}  ${m.status}${m.minute ? ` ${m.minute}'` : ''}  ${m.score.home ?? '-'}-${m.score.away ?? '-'}  model ${p.home}/${p.draw}/${p.away}`);
}
const st = await service.standings('PL');
console.log(`\nPL table: ${st?.table.length ?? 0} rows, leader ${st?.table[0]?.team.name ?? '?'} (${st?.table[0]?.points ?? '?'} pts, form ${st?.table[0]?.form || 'n/a'})`);
console.log('\nLooks good. Run: npm start   then open http://127.0.0.1:3000 and check the pill reads "Live".');
